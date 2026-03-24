using Eryx.AgentHost.Contracts;

namespace Eryx.AgentHost.Services;

internal sealed record PatternHandoffRoute(string SourceAgentId, string TargetAgentId);

internal sealed record PatternHandoffTopology(string EntryAgentId, IReadOnlyList<PatternHandoffRoute> Routes);

internal static class PatternGraphResolver
{
    private const string UserInputKind = "user-input";
    private const string UserOutputKind = "user-output";
    private const string AgentKind = "agent";
    private const string DistributorKind = "distributor";
    private const string CollectorKind = "collector";
    private const string OrchestratorKind = "orchestrator";

    private static readonly StringComparer Comparer = StringComparer.OrdinalIgnoreCase;

    public static PatternGraphDto Resolve(PatternDefinitionDto pattern)
        => pattern.Graph ?? CreateDefault(pattern);

    public static IReadOnlyList<string> ResolveOrderedAgentIds(PatternDefinitionDto pattern)
    {
        PatternGraphDto graph = Resolve(pattern);

        return pattern.Mode switch
        {
            "single" or "sequential" or "magentic" => ResolveLinearAgentIds(pattern, graph),
            "concurrent" or "group-chat" or "handoff" => ResolveAgentOrder(pattern, graph),
            _ => pattern.Agents.Select(agent => agent.Id).ToList()
        };
    }

    public static PatternHandoffTopology ResolveHandoff(PatternDefinitionDto pattern)
    {
        return TryResolveHandoff(pattern, Resolve(pattern))
            ?? TryResolveHandoff(pattern, CreateDefault(pattern))
            ?? new PatternHandoffTopology(
                pattern.Agents.FirstOrDefault()?.Id ?? string.Empty,
                []);
    }

    public static PatternGraphDto CreateDefault(PatternDefinitionDto pattern)
    {
        return pattern.Mode switch
        {
            "single" or "sequential" or "magentic" => CreateLinearGraph(pattern.Agents),
            "concurrent" => CreateConcurrentGraph(pattern.Agents),
            "handoff" => CreateHandoffGraph(pattern.Agents),
            "group-chat" => CreateGroupChatGraph(pattern.Agents),
            _ => CreateLinearGraph(pattern.Agents)
        };
    }

    private static IReadOnlyList<string> ResolveLinearAgentIds(PatternDefinitionDto pattern, PatternGraphDto graph)
    {
        PatternGraphNodeDto? inputNode = GetNodeByKind(graph, UserInputKind);
        PatternGraphNodeDto? outputNode = GetNodeByKind(graph, UserOutputKind);
        if (inputNode is null || outputNode is null)
        {
            return pattern.Agents.Select(agent => agent.Id).ToList();
        }

        Dictionary<string, PatternGraphNodeDto> nodesById = graph.Nodes.ToDictionary(node => node.Id, node => node);
        Dictionary<string, List<PatternGraphEdgeDto>> outgoing = BuildOutgoingLookup(graph);
        List<string> orderedAgentIds = [];
        HashSet<string> visitedNodeIds = [];
        string currentNodeId = inputNode.Id;

        while (visitedNodeIds.Add(currentNodeId))
        {
            if (!outgoing.TryGetValue(currentNodeId, out List<PatternGraphEdgeDto>? edges) || edges.Count != 1)
            {
                break;
            }

            string nextNodeId = edges[0].Target;
            if (!nodesById.TryGetValue(nextNodeId, out PatternGraphNodeDto? nextNode))
            {
                break;
            }

            if (Comparer.Equals(nextNode.Id, outputNode.Id))
            {
                break;
            }

            if (Comparer.Equals(nextNode.Kind, AgentKind) && !string.IsNullOrWhiteSpace(nextNode.AgentId))
            {
                orderedAgentIds.Add(nextNode.AgentId);
            }

            currentNodeId = nextNodeId;
        }

        return orderedAgentIds.Count == pattern.Agents.Count
            ? orderedAgentIds
            : pattern.Agents.Select(agent => agent.Id).ToList();
    }

    private static IReadOnlyList<string> ResolveAgentOrder(PatternDefinitionDto pattern, PatternGraphDto graph)
    {
        Dictionary<string, int> fallbackOrder = pattern.Agents
            .Select((agent, index) => new { agent.Id, Index = index })
            .ToDictionary(item => item.Id, item => item.Index);

        List<string> orderedAgentIds = graph.Nodes
            .Where(node => Comparer.Equals(node.Kind, AgentKind) && !string.IsNullOrWhiteSpace(node.AgentId))
            .OrderBy(node => node.Order ?? int.MaxValue)
            .ThenBy(node => fallbackOrder.GetValueOrDefault(node.AgentId!, int.MaxValue))
            .Select(node => node.AgentId!)
            .Distinct()
            .ToList();

        return orderedAgentIds.Count == pattern.Agents.Count
            ? orderedAgentIds
            : pattern.Agents.Select(agent => agent.Id).ToList();
    }

    private static PatternHandoffTopology? TryResolveHandoff(PatternDefinitionDto pattern, PatternGraphDto graph)
    {
        Dictionary<string, PatternGraphNodeDto> nodesById = graph.Nodes.ToDictionary(node => node.Id, node => node);
        PatternGraphNodeDto? inputNode = GetNodeByKind(graph, UserInputKind);
        string? entryAgentId = null;

        if (inputNode is not null)
        {
            entryAgentId = graph.Edges
                .Where(edge => Comparer.Equals(edge.Source, inputNode.Id))
                .Select(edge => nodesById.TryGetValue(edge.Target, out PatternGraphNodeDto? targetNode)
                    ? targetNode.AgentId
                    : null)
                .FirstOrDefault(agentId => !string.IsNullOrWhiteSpace(agentId));
        }

        List<PatternHandoffRoute> routes = graph.Edges
            .Select(edge => (SourceNode: nodesById.GetValueOrDefault(edge.Source), TargetNode: nodesById.GetValueOrDefault(edge.Target)))
            .Where(item =>
                item.SourceNode is not null
                && item.TargetNode is not null
                && Comparer.Equals(item.SourceNode.Kind, AgentKind)
                && Comparer.Equals(item.TargetNode.Kind, AgentKind)
                && !string.IsNullOrWhiteSpace(item.SourceNode.AgentId)
                && !string.IsNullOrWhiteSpace(item.TargetNode.AgentId))
            .Select(item => new PatternHandoffRoute(item.SourceNode!.AgentId!, item.TargetNode!.AgentId!))
            .Distinct()
            .ToList();

        if (string.IsNullOrWhiteSpace(entryAgentId) || routes.Count == 0)
        {
            return null;
        }

        return new PatternHandoffTopology(entryAgentId!, routes);
    }

    private static Dictionary<string, List<PatternGraphEdgeDto>> BuildOutgoingLookup(PatternGraphDto graph)
    {
        Dictionary<string, List<PatternGraphEdgeDto>> lookup = new(StringComparer.Ordinal);
        foreach (PatternGraphNodeDto node in graph.Nodes)
        {
            lookup[node.Id] = [];
        }

        foreach (PatternGraphEdgeDto edge in graph.Edges)
        {
            if (!lookup.TryGetValue(edge.Source, out List<PatternGraphEdgeDto>? edges))
            {
                edges = [];
                lookup[edge.Source] = edges;
            }

            edges.Add(edge);
        }

        return lookup;
    }

    private static PatternGraphNodeDto? GetNodeByKind(PatternGraphDto graph, string kind)
        => graph.Nodes.FirstOrDefault(node => Comparer.Equals(node.Kind, kind));

    private static PatternGraphDto CreateLinearGraph(IReadOnlyList<PatternAgentDefinitionDto> agents)
    {
        PatternGraphNodeDto inputNode = CreateSystemNode("system-user-input", UserInputKind, 0, 0);
        PatternGraphNodeDto outputNode = CreateSystemNode("system-user-output", UserOutputKind, 220 * Math.Max(agents.Count + 1, 2), 0);
        List<PatternGraphNodeDto> agentNodes = agents
            .Select((agent, index) => CreateAgentNode(agent, index, 220 * (index + 1), 0))
            .ToList();
        List<PatternGraphEdgeDto> edges = [];
        List<string> path = [inputNode.Id, .. agentNodes.Select(node => node.Id), outputNode.Id];
        for (int index = 0; index < path.Count - 1; index += 1)
        {
            edges.Add(CreateEdge(path[index], path[index + 1]));
        }

        return new PatternGraphDto
        {
            Nodes = [inputNode, .. agentNodes, outputNode],
            Edges = edges
        };
    }

    private static PatternGraphDto CreateConcurrentGraph(IReadOnlyList<PatternAgentDefinitionDto> agents)
    {
        PatternGraphNodeDto inputNode = CreateSystemNode("system-user-input", UserInputKind, 0, 0);
        PatternGraphNodeDto distributorNode = CreateSystemNode("system-distributor", DistributorKind, 190, 0);
        PatternGraphNodeDto collectorNode = CreateSystemNode("system-collector", CollectorKind, 650, 0);
        PatternGraphNodeDto outputNode = CreateSystemNode("system-user-output", UserOutputKind, 860, 0);
        List<PatternGraphNodeDto> agentNodes = agents
            .Select((agent, index) => CreateAgentNode(agent, index, 430, SpreadY(index, Math.Max(agents.Count, 1), 170)))
            .ToList();

        return new PatternGraphDto
        {
            Nodes = [inputNode, distributorNode, .. agentNodes, collectorNode, outputNode],
            Edges =
            [
                CreateEdge(inputNode.Id, distributorNode.Id),
                .. agentNodes.Select(node => CreateEdge(distributorNode.Id, node.Id)),
                .. agentNodes.Select(node => CreateEdge(node.Id, collectorNode.Id)),
                CreateEdge(collectorNode.Id, outputNode.Id)
            ]
        };
    }

    private static PatternGraphDto CreateHandoffGraph(IReadOnlyList<PatternAgentDefinitionDto> agents)
    {
        PatternGraphNodeDto inputNode = CreateSystemNode("system-user-input", UserInputKind, 0, 0);
        PatternGraphNodeDto outputNode = CreateSystemNode("system-user-output", UserOutputKind, 860, 0);
        PatternAgentDefinitionDto? entryAgent = agents.FirstOrDefault();
        PatternGraphNodeDto? entryNode = entryAgent is null
            ? null
            : CreateAgentNode(entryAgent, 0, 220, 0);
        List<PatternGraphNodeDto> specialistNodes = agents
            .Skip(1)
            .Select((agent, index) => CreateAgentNode(agent, index + 1, 540, SpreadY(index, Math.Max(agents.Count - 1, 1), 220)))
            .ToList();

        List<PatternGraphEdgeDto> edges = [];
        if (entryNode is not null)
        {
            edges.Add(CreateEdge(inputNode.Id, entryNode.Id));
            edges.Add(CreateEdge(entryNode.Id, outputNode.Id));

            foreach (PatternGraphNodeDto specialistNode in specialistNodes)
            {
                edges.Add(CreateEdge(entryNode.Id, specialistNode.Id));
                edges.Add(CreateEdge(specialistNode.Id, entryNode.Id));
                edges.Add(CreateEdge(specialistNode.Id, outputNode.Id));
            }
        }

        List<PatternGraphNodeDto> nodes = [inputNode];
        if (entryNode is not null)
        {
            nodes.Add(entryNode);
        }
        nodes.AddRange(specialistNodes);
        nodes.Add(outputNode);

        return new PatternGraphDto
        {
            Nodes = nodes,
            Edges = edges
        };
    }

    private static PatternGraphDto CreateGroupChatGraph(IReadOnlyList<PatternAgentDefinitionDto> agents)
    {
        PatternGraphNodeDto inputNode = CreateSystemNode("system-user-input", UserInputKind, 0, 0);
        PatternGraphNodeDto orchestratorNode = CreateSystemNode("system-orchestrator", OrchestratorKind, 250, 0);
        PatternGraphNodeDto outputNode = CreateSystemNode("system-user-output", UserOutputKind, 900, 0);
        const double centerX = 560;
        const double centerY = 0;
        const double radiusX = 190;
        const double radiusY = 170;

        List<PatternGraphNodeDto> agentNodes = agents
            .Select((agent, index) =>
            {
                double angle = agents.Count <= 1
                    ? 0
                    : (Math.PI * 2 * index) / agents.Count - (Math.PI / 2);
                return CreateAgentNode(
                    agent,
                    index,
                    Math.Round(centerX + Math.Cos(angle) * radiusX),
                    Math.Round(centerY + Math.Sin(angle) * radiusY));
            })
            .ToList();

        return new PatternGraphDto
        {
            Nodes = [inputNode, orchestratorNode, .. agentNodes, outputNode],
            Edges =
            [
                CreateEdge(inputNode.Id, orchestratorNode.Id),
                .. agentNodes.SelectMany(node => new[]
                {
                    CreateEdge(orchestratorNode.Id, node.Id),
                    CreateEdge(node.Id, orchestratorNode.Id)
                }),
                CreateEdge(orchestratorNode.Id, outputNode.Id)
            ]
        };
    }

    private static PatternGraphNodeDto CreateSystemNode(string id, string kind, double x, double y)
        => new()
        {
            Id = id,
            Kind = kind,
            Position = new PatternGraphPositionDto
            {
                X = x,
                Y = y
            }
        };

    private static PatternGraphNodeDto CreateAgentNode(PatternAgentDefinitionDto agent, int order, double x, double y)
        => new()
        {
            Id = $"agent-node-{agent.Id}",
            Kind = AgentKind,
            AgentId = agent.Id,
            Order = order,
            Position = new PatternGraphPositionDto
            {
                X = x,
                Y = y
            }
        };

    private static PatternGraphEdgeDto CreateEdge(string source, string target)
        => new()
        {
            Id = $"edge-{source}-to-{target}",
            Source = source,
            Target = target
        };

    private static double SpreadY(int index, int count, double gap)
        => (index - ((count - 1) / 2d)) * gap;
}
