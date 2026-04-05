using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

public sealed class WorkflowValidator
{
    private static readonly HashSet<string> ExecutableNodeKinds = new(StringComparer.OrdinalIgnoreCase)
    {
        "start",
        "end",
        "agent",
    };

    public IReadOnlyList<WorkflowValidationIssueDto> Validate(WorkflowDefinitionDto workflow)
    {
        List<WorkflowValidationIssueDto> issues = [];

        if (string.IsNullOrWhiteSpace(workflow.Name))
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "name",
                Message = "Workflow name is required.",
            });
        }

        if (workflow.Graph.Nodes.Count == 0)
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph",
                Message = "Workflow graph must include nodes.",
            });
            return issues;
        }

        Dictionary<string, WorkflowNodeDto> nodesById = new(StringComparer.Ordinal);
        HashSet<string> edgeIds = new(StringComparer.Ordinal);
        Dictionary<string, int> incomingCounts = new(StringComparer.Ordinal);
        Dictionary<string, int> outgoingCounts = new(StringComparer.Ordinal);

        foreach (WorkflowNodeDto node in workflow.Graph.Nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Id))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.nodes.id",
                    Message = "Workflow nodes must have an ID.",
                });
                continue;
            }

            if (!nodesById.TryAdd(node.Id, node))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.nodes.id",
                    NodeId = node.Id,
                    Message = $"Workflow graph contains duplicate node \"{node.Id}\".",
                });
                continue;
            }

            if (!ExecutableNodeKinds.Contains(node.Kind))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.nodes.kind",
                    NodeId = node.Id,
                    Message = $"Workflow node kind \"{node.Kind}\" is not executable yet.",
                });
            }

            if (string.Equals(node.Kind, "agent", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(node.Config.Name))
                {
                    issues.Add(new WorkflowValidationIssueDto
                    {
                        Field = "graph.nodes.config.name",
                        NodeId = node.Id,
                        Message = "Agent nodes require a name.",
                    });
                }

                if (string.IsNullOrWhiteSpace(node.Config.Model))
                {
                    issues.Add(new WorkflowValidationIssueDto
                    {
                        Field = "graph.nodes.config.model",
                        NodeId = node.Id,
                        Message = $"Agent node \"{node.Label}\" requires a model.",
                    });
                }
            }
        }

        foreach (WorkflowEdgeDto edge in workflow.Graph.Edges)
        {
            if (string.IsNullOrWhiteSpace(edge.Id))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.id",
                    Message = "Workflow edges must have an ID.",
                });
                continue;
            }

            if (!edgeIds.Add(edge.Id))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.id",
                    EdgeId = edge.Id,
                    Message = $"Workflow graph contains duplicate edge \"{edge.Id}\".",
                });
            }

            if (!nodesById.ContainsKey(edge.Source) || !nodesById.ContainsKey(edge.Target))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges",
                    EdgeId = edge.Id,
                    Message = $"Workflow edge \"{edge.Id}\" must connect known nodes.",
                });
                continue;
            }

            outgoingCounts[edge.Source] = outgoingCounts.TryGetValue(edge.Source, out int outgoing)
                ? outgoing + 1
                : 1;
            incomingCounts[edge.Target] = incomingCounts.TryGetValue(edge.Target, out int incoming)
                ? incoming + 1
                : 1;
        }

        List<WorkflowNodeDto> startNodes = workflow.Graph.Nodes
            .Where(node => string.Equals(node.Kind, "start", StringComparison.OrdinalIgnoreCase))
            .ToList();
        List<WorkflowNodeDto> endNodes = workflow.Graph.Nodes
            .Where(node => string.Equals(node.Kind, "end", StringComparison.OrdinalIgnoreCase))
            .ToList();
        List<WorkflowNodeDto> agentNodes = workflow.Graph.Nodes
            .Where(node => string.Equals(node.Kind, "agent", StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (startNodes.Count != 1)
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.nodes",
                Message = "Workflow graphs must contain exactly one start node.",
            });
        }

        if (endNodes.Count != 1)
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.nodes",
                Message = "Workflow graphs must contain exactly one end node.",
            });
        }

        if (agentNodes.Count == 0)
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.nodes",
                Message = "Workflow graphs must contain at least one agent node.",
            });
        }

        foreach (WorkflowNodeDto startNode in startNodes)
        {
            if (incomingCounts.GetValueOrDefault(startNode.Id) != 0)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges",
                    NodeId = startNode.Id,
                    Message = "Start nodes cannot have incoming edges.",
                });
            }

            if (outgoingCounts.GetValueOrDefault(startNode.Id) == 0)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges",
                    NodeId = startNode.Id,
                    Message = "Start nodes must connect to at least one downstream node.",
                });
            }
        }

        foreach (WorkflowNodeDto endNode in endNodes)
        {
            if (outgoingCounts.GetValueOrDefault(endNode.Id) != 0)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges",
                    NodeId = endNode.Id,
                    Message = "End nodes cannot have outgoing edges.",
                });
            }
        }

        foreach (IGrouping<string, WorkflowEdgeDto> fanOutGroup in workflow.Graph.Edges
                     .Where(edge => string.Equals(edge.Kind, "fan-out", StringComparison.OrdinalIgnoreCase))
                     .GroupBy(edge => edge.Source, StringComparer.Ordinal))
        {
            if (fanOutGroup.Count() < 2)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.kind",
                    NodeId = fanOutGroup.Key,
                    Message = "Fan-out edges require at least two outgoing fan-out connections from the same source.",
                });
            }
        }

        foreach (IGrouping<string, WorkflowEdgeDto> fanInGroup in workflow.Graph.Edges
                     .Where(edge => string.Equals(edge.Kind, "fan-in", StringComparison.OrdinalIgnoreCase))
                     .GroupBy(edge => edge.Target, StringComparer.Ordinal))
        {
            if (fanInGroup.Count() < 2)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.kind",
                    NodeId = fanInGroup.Key,
                    Message = "Fan-in edges require at least two incoming fan-in connections to the same target.",
                });
            }
        }

        WorkflowNodeDto? start = startNodes.FirstOrDefault();
        if (start is not null && endNodes.Count > 0 && !HasPathToAnyEnd(start.Id, workflow.Graph, endNodes.Select(node => node.Id)))
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.edges",
                Message = "Workflow graph must include a path from the start node to at least one end node.",
            });
        }

        return issues;
    }

    private static bool HasPathToAnyEnd(
        string startNodeId,
        WorkflowGraphDto graph,
        IEnumerable<string> endNodeIds)
    {
        HashSet<string> endSet = endNodeIds.ToHashSet(StringComparer.Ordinal);
        Dictionary<string, List<string>> outgoing = graph.Edges
            .GroupBy(edge => edge.Source, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.Select(edge => edge.Target).ToList(),
                StringComparer.Ordinal);

        Queue<string> queue = new([startNodeId]);
        HashSet<string> visited = new(StringComparer.Ordinal);
        while (queue.Count > 0)
        {
            string current = queue.Dequeue();
            if (!visited.Add(current))
            {
                continue;
            }

            if (endSet.Contains(current))
            {
                return true;
            }

            foreach (string target in outgoing.GetValueOrDefault(current, []))
            {
                queue.Enqueue(target);
            }
        }

        return false;
    }
}
