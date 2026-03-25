using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

public sealed class PatternValidator
{
    private static readonly StringComparer Comparer = StringComparer.OrdinalIgnoreCase;

    public IReadOnlyList<PatternValidationIssueDto> Validate(PatternDefinitionDto pattern)
    {
        List<PatternValidationIssueDto> issues = [];

        if (string.IsNullOrWhiteSpace(pattern.Name))
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "name",
                Message = "Pattern name is required.",
            });
        }

        if (string.Equals(pattern.Availability, "unavailable", StringComparison.OrdinalIgnoreCase))
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "availability",
                Message = pattern.UnavailabilityReason ?? "This orchestration mode is currently unavailable.",
            });
        }

        if (pattern.Agents.Count == 0)
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "agents",
                Message = "At least one agent is required.",
            });
        }

        if (string.Equals(pattern.Mode, "single", StringComparison.OrdinalIgnoreCase) && pattern.Agents.Count != 1)
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "agents",
                Message = "Single-agent chat requires exactly one agent.",
            });
        }

        if (string.Equals(pattern.Mode, "handoff", StringComparison.OrdinalIgnoreCase) && pattern.Agents.Count < 2)
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "agents",
                Message = "Handoff orchestration requires at least two agents.",
            });
        }

        if (string.Equals(pattern.Mode, "group-chat", StringComparison.OrdinalIgnoreCase) && pattern.Agents.Count < 2)
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "agents",
                Message = "Group chat requires at least two agents.",
            });
        }

        if (string.Equals(pattern.Mode, "magentic", StringComparison.OrdinalIgnoreCase))
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "mode",
                Message = pattern.UnavailabilityReason
                    ?? "Magentic orchestration is currently documented as unsupported in the .NET Agent Framework.",
            });
        }

        foreach (PatternAgentDefinitionDto agent in pattern.Agents)
        {
            if (string.IsNullOrWhiteSpace(agent.Name))
            {
                issues.Add(new PatternValidationIssueDto
                {
                    Field = "agents.name",
                    Message = "Every agent needs a name.",
                });
            }

            if (string.IsNullOrWhiteSpace(agent.Model))
            {
                issues.Add(new PatternValidationIssueDto
                {
                    Field = "agents.model",
                    Message = $"Agent \"{agent.Name}\" requires a model identifier.",
                });
            }
        }

        ValidateGraph(pattern, PatternGraphResolver.Resolve(pattern), issues);
        return issues;
    }

    private static void ValidateGraph(
        PatternDefinitionDto pattern,
        PatternGraphDto graph,
        List<PatternValidationIssueDto> issues)
    {
        if (graph.Nodes.Count == 0)
        {
            AddGraphIssue(issues, "Pattern graph must include nodes.");
            return;
        }

        HashSet<string> nodeIds = new(StringComparer.Ordinal);
        HashSet<string> edgeIds = new(StringComparer.Ordinal);
        HashSet<string> agentIds = pattern.Agents.Select(agent => agent.Id).ToHashSet(StringComparer.Ordinal);
        HashSet<string> seenAgentIds = new(StringComparer.Ordinal);
        HashSet<int> seenAgentOrders = [];
        Dictionary<string, PatternGraphNodeDto> nodesById = new(StringComparer.Ordinal);

        foreach (PatternGraphNodeDto node in graph.Nodes)
        {
            if (!nodeIds.Add(node.Id))
            {
                AddGraphIssue(issues, $"Pattern graph contains duplicate node \"{node.Id}\".");
            }

            nodesById[node.Id] = node;

            if (Comparer.Equals(node.Kind, "agent"))
            {
                if (string.IsNullOrWhiteSpace(node.AgentId) || !agentIds.Contains(node.AgentId))
                {
                    AddGraphIssue(issues, $"Agent node \"{node.Id}\" must reference a known agent.");
                }

                if (!string.IsNullOrWhiteSpace(node.AgentId) && !seenAgentIds.Add(node.AgentId))
                {
                    AddGraphIssue(issues, $"Pattern graph contains multiple nodes for agent \"{node.AgentId}\".");
                }

                if (!node.Order.HasValue)
                {
                    AddGraphIssue(issues, $"Agent node \"{node.Id}\" must define an order.");
                }
                else if (!seenAgentOrders.Add(node.Order.Value))
                {
                    AddGraphIssue(issues, $"Pattern graph contains duplicate agent order \"{node.Order.Value}\".");
                }
            }
            else if (!string.IsNullOrWhiteSpace(node.AgentId))
            {
                AddGraphIssue(issues, $"System node \"{node.Id}\" cannot reference an agent.");
            }
        }

        foreach (PatternAgentDefinitionDto agent in pattern.Agents)
        {
            if (!seenAgentIds.Contains(agent.Id))
            {
                AddGraphIssue(issues, $"Pattern graph is missing node metadata for agent \"{agent.Id}\".");
            }
        }

        foreach (PatternGraphEdgeDto edge in graph.Edges)
        {
            if (!edgeIds.Add(edge.Id))
            {
                AddGraphIssue(issues, $"Pattern graph contains duplicate edge \"{edge.Id}\".");
            }

            if (!nodesById.ContainsKey(edge.Source) || !nodesById.ContainsKey(edge.Target))
            {
                AddGraphIssue(issues, $"Pattern graph edge \"{edge.Id}\" must connect known nodes.");
            }
        }

        switch (pattern.Mode)
        {
            case "single":
            case "sequential":
            case "magentic":
                ValidateLinearGraph(pattern, graph, issues);
                break;
            case "concurrent":
                ValidateConcurrentGraph(pattern, graph, issues);
                break;
            case "handoff":
                ValidateHandoffGraph(graph, issues);
                break;
            case "group-chat":
                ValidateGroupChatGraph(pattern, graph, issues);
                break;
        }
    }

    private static void ValidateLinearGraph(
        PatternDefinitionDto pattern,
        PatternGraphDto graph,
        List<PatternValidationIssueDto> issues)
    {
        ValidateSystemNodeCounts(graph, ["user-input", "user-output"], issues);
        PatternGraphNodeDto? inputNode = GetNodeByKind(graph, "user-input");
        PatternGraphNodeDto? outputNode = GetNodeByKind(graph, "user-output");
        if (inputNode is null || outputNode is null)
        {
            return;
        }

        Dictionary<string, List<PatternGraphEdgeDto>> incoming = BuildIncomingLookup(graph);
        Dictionary<string, List<PatternGraphEdgeDto>> outgoing = BuildOutgoingLookup(graph);
        List<PatternGraphNodeDto> agentNodes = GetAgentNodes(graph);

        if (graph.Edges.Count != pattern.Agents.Count + 1)
        {
            AddGraphIssue(issues, "Linear orchestration graphs must be a single path from user input through every agent to user output.");
        }

        if (incoming.GetValueOrDefault(inputNode.Id, []).Count != 0 || outgoing.GetValueOrDefault(inputNode.Id, []).Count != 1)
        {
            AddGraphIssue(issues, "User input must start exactly one path.");
        }

        if (incoming.GetValueOrDefault(outputNode.Id, []).Count != 1 || outgoing.GetValueOrDefault(outputNode.Id, []).Count != 0)
        {
            AddGraphIssue(issues, "User output must terminate exactly one path.");
        }

        foreach (PatternGraphNodeDto node in agentNodes)
        {
            if (incoming.GetValueOrDefault(node.Id, []).Count != 1 || outgoing.GetValueOrDefault(node.Id, []).Count != 1)
            {
                AddGraphIssue(issues, "Each agent in a linear orchestration must have exactly one incoming and one outgoing edge.");
                break;
            }
        }

        HashSet<string> visited = new(StringComparer.Ordinal);
        string currentNodeId = inputNode.Id;
        while (visited.Add(currentNodeId))
        {
            List<PatternGraphEdgeDto> nextEdges = outgoing.GetValueOrDefault(currentNodeId, []);
            if (nextEdges.Count == 0)
            {
                break;
            }

            if (nextEdges.Count != 1)
            {
                AddGraphIssue(issues, "Linear orchestration nodes may only branch to one next step.");
                break;
            }

            currentNodeId = nextEdges[0].Target;
            if (Comparer.Equals(currentNodeId, outputNode.Id))
            {
                visited.Add(currentNodeId);
                break;
            }
        }

        HashSet<string> expectedVisited = new(StringComparer.Ordinal)
        {
            inputNode.Id,
            outputNode.Id
        };
        foreach (PatternGraphNodeDto node in agentNodes)
        {
            expectedVisited.Add(node.Id);
        }

        if (!expectedVisited.SetEquals(visited))
        {
            AddGraphIssue(issues, "Linear orchestration graphs must visit every agent exactly once.");
        }
    }

    private static void ValidateConcurrentGraph(
        PatternDefinitionDto pattern,
        PatternGraphDto graph,
        List<PatternValidationIssueDto> issues)
    {
        ValidateSystemNodeCounts(graph, ["user-input", "distributor", "collector", "user-output"], issues);
        PatternGraphNodeDto? inputNode = GetNodeByKind(graph, "user-input");
        PatternGraphNodeDto? distributorNode = GetNodeByKind(graph, "distributor");
        PatternGraphNodeDto? collectorNode = GetNodeByKind(graph, "collector");
        PatternGraphNodeDto? outputNode = GetNodeByKind(graph, "user-output");
        if (inputNode is null || distributorNode is null || collectorNode is null || outputNode is null)
        {
            return;
        }

        Dictionary<string, List<PatternGraphEdgeDto>> incoming = BuildIncomingLookup(graph);
        Dictionary<string, List<PatternGraphEdgeDto>> outgoing = BuildOutgoingLookup(graph);
        List<PatternGraphNodeDto> agentNodes = GetAgentNodes(graph);
        HashSet<string> distributorTargets = outgoing.GetValueOrDefault(distributorNode.Id, []).Select(edge => edge.Target).ToHashSet(StringComparer.Ordinal);
        HashSet<string> collectorSources = incoming.GetValueOrDefault(collectorNode.Id, []).Select(edge => edge.Source).ToHashSet(StringComparer.Ordinal);

        if (graph.Edges.Count != pattern.Agents.Count * 2 + 2)
        {
            AddGraphIssue(issues, "Concurrent orchestration graphs must fan out from the distributor and fan back into the collector.");
        }

        if (incoming.GetValueOrDefault(inputNode.Id, []).Count != 0 || outgoing.GetValueOrDefault(inputNode.Id, []).Count != 1)
        {
            AddGraphIssue(issues, "User input must connect only to the distributor.");
        }

        if (incoming.GetValueOrDefault(distributorNode.Id, []).Count != 1)
        {
            AddGraphIssue(issues, "Distributor must receive exactly one edge from user input.");
        }

        if (outgoing.GetValueOrDefault(collectorNode.Id, []).Count != 1 || incoming.GetValueOrDefault(outputNode.Id, []).Count != 1)
        {
            AddGraphIssue(issues, "Collector must forward exactly one edge to user output.");
        }

        foreach (PatternGraphNodeDto agentNode in agentNodes)
        {
            if (!distributorTargets.Contains(agentNode.Id))
            {
                AddGraphIssue(issues, $"Distributor must connect to agent \"{agentNode.AgentId}\".");
            }

            if (!collectorSources.Contains(agentNode.Id))
            {
                AddGraphIssue(issues, $"Agent \"{agentNode.AgentId}\" must connect to the collector.");
            }
        }
    }

    private static void ValidateHandoffGraph(
        PatternGraphDto graph,
        List<PatternValidationIssueDto> issues)
    {
        ValidateSystemNodeCounts(graph, ["user-input", "user-output"], issues);
        PatternGraphNodeDto? inputNode = GetNodeByKind(graph, "user-input");
        PatternGraphNodeDto? outputNode = GetNodeByKind(graph, "user-output");
        if (inputNode is null || outputNode is null)
        {
            return;
        }

        Dictionary<string, List<PatternGraphEdgeDto>> incoming = BuildIncomingLookup(graph);
        Dictionary<string, List<PatternGraphEdgeDto>> outgoing = BuildOutgoingLookup(graph);
        List<PatternGraphNodeDto> agentNodes = GetAgentNodes(graph);
        HashSet<string> agentNodeIds = agentNodes.Select(node => node.Id).ToHashSet(StringComparer.Ordinal);
        List<PatternGraphEdgeDto> entryEdges = outgoing.GetValueOrDefault(inputNode.Id, []);
        List<PatternGraphEdgeDto> completionEdges = incoming.GetValueOrDefault(outputNode.Id, []);

        if (entryEdges.Count != 1)
        {
            AddGraphIssue(issues, "Handoff graphs must connect user input to exactly one entry agent.");
            return;
        }

        if (!agentNodeIds.Contains(entryEdges[0].Target))
        {
            AddGraphIssue(issues, "Handoff entry edges must target an agent node.");
        }

        if (completionEdges.Count == 0)
        {
            AddGraphIssue(issues, "Handoff graphs must allow at least one agent to complete back to user output.");
        }

        bool hasAgentToAgentRoute = false;
        foreach (PatternGraphEdgeDto edge in graph.Edges)
        {
            if (Comparer.Equals(edge.Source, inputNode.Id))
            {
                continue;
            }

            if (Comparer.Equals(edge.Target, outputNode.Id))
            {
                if (!agentNodeIds.Contains(edge.Source))
                {
                    AddGraphIssue(issues, "Only agent nodes may complete to user output.");
                }
                continue;
            }

            if (!agentNodeIds.Contains(edge.Source) || !agentNodeIds.Contains(edge.Target))
            {
                AddGraphIssue(issues, "Handoff routes may only connect agents to agents or agents to user output.");
                continue;
            }

            if (Comparer.Equals(edge.Source, edge.Target))
            {
                AddGraphIssue(issues, "Handoff routes cannot target the same agent node.");
            }

            hasAgentToAgentRoute = true;
        }

        if (!hasAgentToAgentRoute && agentNodes.Count > 1)
        {
            AddGraphIssue(issues, "Handoff graphs must include at least one agent-to-agent handoff route.");
        }

        HashSet<string> reachable = new(StringComparer.Ordinal);
        Stack<string> stack = new Stack<string>([entryEdges[0].Target]);
        while (stack.Count > 0)
        {
            string nodeId = stack.Pop();
            if (!reachable.Add(nodeId))
            {
                continue;
            }

            foreach (PatternGraphEdgeDto edge in outgoing.GetValueOrDefault(nodeId, []))
            {
                if (agentNodeIds.Contains(edge.Target) && !reachable.Contains(edge.Target))
                {
                    stack.Push(edge.Target);
                }
            }
        }

        foreach (PatternGraphNodeDto agentNode in agentNodes)
        {
            if (!reachable.Contains(agentNode.Id))
            {
                AddGraphIssue(issues, $"Handoff entry agent must be able to reach \"{agentNode.AgentId}\".");
            }
        }

        if (incoming.GetValueOrDefault(inputNode.Id, []).Count != 0 || outgoing.GetValueOrDefault(outputNode.Id, []).Count != 0)
        {
            AddGraphIssue(issues, "User input cannot have incoming edges and user output cannot have outgoing edges.");
        }
    }

    private static void ValidateGroupChatGraph(
        PatternDefinitionDto pattern,
        PatternGraphDto graph,
        List<PatternValidationIssueDto> issues)
    {
        ValidateSystemNodeCounts(graph, ["user-input", "orchestrator", "user-output"], issues);
        PatternGraphNodeDto? inputNode = GetNodeByKind(graph, "user-input");
        PatternGraphNodeDto? orchestratorNode = GetNodeByKind(graph, "orchestrator");
        PatternGraphNodeDto? outputNode = GetNodeByKind(graph, "user-output");
        if (inputNode is null || orchestratorNode is null || outputNode is null)
        {
            return;
        }

        Dictionary<string, List<PatternGraphEdgeDto>> incoming = BuildIncomingLookup(graph);
        Dictionary<string, List<PatternGraphEdgeDto>> outgoing = BuildOutgoingLookup(graph);
        List<PatternGraphNodeDto> agentNodes = GetAgentNodes(graph);
        HashSet<string> orchestratorTargets = outgoing.GetValueOrDefault(orchestratorNode.Id, []).Select(edge => edge.Target).ToHashSet(StringComparer.Ordinal);
        HashSet<string> orchestratorSources = incoming.GetValueOrDefault(orchestratorNode.Id, []).Select(edge => edge.Source).ToHashSet(StringComparer.Ordinal);

        if (graph.Edges.Count != pattern.Agents.Count * 2 + 2)
        {
            AddGraphIssue(issues, "Group chat graphs must connect the orchestrator to every participant and then back to user output.");
        }

        if (outgoing.GetValueOrDefault(inputNode.Id, []).Any(edge => !Comparer.Equals(edge.Target, orchestratorNode.Id)))
        {
            AddGraphIssue(issues, "User input must only connect to the orchestrator.");
        }

        if (!outgoing.GetValueOrDefault(orchestratorNode.Id, []).Any(edge => Comparer.Equals(edge.Target, outputNode.Id)))
        {
            AddGraphIssue(issues, "Group chat orchestrator must connect to user output.");
        }

        foreach (PatternGraphNodeDto agentNode in agentNodes)
        {
            if (!orchestratorTargets.Contains(agentNode.Id))
            {
                AddGraphIssue(issues, $"Orchestrator must connect to agent \"{agentNode.AgentId}\".");
            }

            if (!orchestratorSources.Contains(agentNode.Id))
            {
                AddGraphIssue(issues, $"Agent \"{agentNode.AgentId}\" must connect back to the orchestrator.");
            }
        }
    }

    private static void ValidateSystemNodeCounts(
        PatternGraphDto graph,
        IReadOnlyList<string> expectedKinds,
        List<PatternValidationIssueDto> issues)
    {
        Dictionary<string, int> counts = graph.Nodes
            .GroupBy(node => node.Kind, Comparer)
            .ToDictionary(group => group.Key, group => group.Count(), Comparer);
        HashSet<string> expected = expectedKinds.ToHashSet(Comparer);

        foreach (string kind in expectedKinds)
        {
            if (counts.GetValueOrDefault(kind, 0) != 1)
            {
                AddGraphIssue(issues, $"Pattern graph must include exactly one \"{kind}\" node.");
            }
        }

        foreach ((string kind, int count) in counts)
        {
            if (Comparer.Equals(kind, "agent"))
            {
                continue;
            }

            if (!expected.Contains(kind) && count > 0)
            {
                AddGraphIssue(issues, $"Pattern graph does not allow \"{kind}\" nodes in this mode.");
            }
        }
    }

    private static PatternGraphNodeDto? GetNodeByKind(PatternGraphDto graph, string kind)
        => graph.Nodes.FirstOrDefault(node => Comparer.Equals(node.Kind, kind));

    private static List<PatternGraphNodeDto> GetAgentNodes(PatternGraphDto graph)
        => graph.Nodes.Where(node => Comparer.Equals(node.Kind, "agent")).ToList();

    private static Dictionary<string, List<PatternGraphEdgeDto>> BuildIncomingLookup(PatternGraphDto graph)
    {
        Dictionary<string, List<PatternGraphEdgeDto>> incoming = new(StringComparer.Ordinal);
        foreach (PatternGraphNodeDto node in graph.Nodes)
        {
            incoming[node.Id] = [];
        }

        foreach (PatternGraphEdgeDto edge in graph.Edges)
        {
            if (!incoming.TryGetValue(edge.Target, out List<PatternGraphEdgeDto>? edges))
            {
                edges = [];
                incoming[edge.Target] = edges;
            }

            edges.Add(edge);
        }

        return incoming;
    }

    private static Dictionary<string, List<PatternGraphEdgeDto>> BuildOutgoingLookup(PatternGraphDto graph)
    {
        Dictionary<string, List<PatternGraphEdgeDto>> outgoing = new(StringComparer.Ordinal);
        foreach (PatternGraphNodeDto node in graph.Nodes)
        {
            outgoing[node.Id] = [];
        }

        foreach (PatternGraphEdgeDto edge in graph.Edges)
        {
            if (!outgoing.TryGetValue(edge.Source, out List<PatternGraphEdgeDto>? edges))
            {
                edges = [];
                outgoing[edge.Source] = edges;
            }

            edges.Add(edge);
        }

        return outgoing;
    }

    private static void AddGraphIssue(List<PatternValidationIssueDto> issues, string message)
        => issues.Add(new PatternValidationIssueDto
        {
            Field = "graph",
            Message = message,
        });
}
