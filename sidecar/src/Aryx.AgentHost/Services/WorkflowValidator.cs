using System.Linq;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

public sealed class WorkflowValidator
{
    private static readonly HashSet<string> ExecutableNodeKinds = new(StringComparer.OrdinalIgnoreCase)
    {
        "start",
        "end",
        "agent",
        "sub-workflow",
    };

    public IReadOnlyList<WorkflowValidationIssueDto> Validate(
        WorkflowDefinitionDto workflow,
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary = null)
    {
        List<WorkflowValidationIssueDto> issues = [];
        Dictionary<string, WorkflowDefinitionDto>? workflowLibraryById = workflowLibrary?
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Id))
            .GroupBy(candidate => candidate.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Last(), StringComparer.Ordinal);

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

            ValidateSubWorkflowNode(node, workflowLibraryById, issues);
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

            ValidateEdgeCondition(edge, issues);
        }

        List<WorkflowNodeDto> startNodes = workflow.Graph.Nodes
            .Where(node => string.Equals(node.Kind, "start", StringComparison.OrdinalIgnoreCase))
            .ToList();
        List<WorkflowNodeDto> endNodes = workflow.Graph.Nodes
            .Where(node => string.Equals(node.Kind, "end", StringComparison.OrdinalIgnoreCase))
            .ToList();
        List<WorkflowNodeDto> executableWorkNodes = workflow.Graph.Nodes
            .Where(node =>
                string.Equals(node.Kind, "agent", StringComparison.OrdinalIgnoreCase)
                || string.Equals(node.Kind, "sub-workflow", StringComparison.OrdinalIgnoreCase))
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

        if (executableWorkNodes.Count == 0)
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.nodes",
                Message = "Workflow graphs must contain at least one agent or sub-workflow node.",
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

        if (workflow.Settings.MaxIterations is int workflowMaxIterations
            && (workflowMaxIterations < 1 || workflowMaxIterations > 100))
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "settings.maxIterations",
                Message = "Workflow maxIterations must be between 1 and 100.",
            });
        }

        foreach (WorkflowEdgeDto edge in workflow.Graph.Edges)
        {
            bool participatesInCycle = IsLoopEdge(workflow.Graph, edge);
            if (!participatesInCycle)
            {
                if (edge.IsLoop == true)
                {
                    issues.Add(new WorkflowValidationIssueDto
                    {
                        Level = "warning",
                        Field = "graph.edges.isLoop",
                        EdgeId = edge.Id,
                        Message = "This edge is marked as a loop but does not currently form a cycle.",
                    });
                }

                continue;
            }

            if (!string.Equals(edge.Kind, "direct", StringComparison.OrdinalIgnoreCase))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.kind",
                    EdgeId = edge.Id,
                    Message = "Loop edges currently support only direct edges.",
                });
            }

            if (edge.IsLoop != true)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.isLoop",
                    EdgeId = edge.Id,
                    Message = "Edges that participate in a cycle must be explicitly marked as loops.",
                });
            }

            if (edge.Condition is null || string.Equals(edge.Condition.Type, "always", StringComparison.OrdinalIgnoreCase))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.condition",
                    EdgeId = edge.Id,
                    Message = "Loop edges require a non-default condition so the loop can terminate.",
                });
            }

            if (edge.MaxIterations is null || edge.MaxIterations < 1)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.maxIterations",
                    EdgeId = edge.Id,
                    Message = "Loop edges require a maxIterations value of at least 1.",
                });
            }

            HashSet<string> componentNodes = CollectStronglyConnectedNodes(workflow.Graph, edge.Source);
            bool hasExitPath = workflow.Graph.Edges.Any(candidate =>
                componentNodes.Contains(candidate.Source) && !componentNodes.Contains(candidate.Target));
            if (!hasExitPath)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges",
                    EdgeId = edge.Id,
                    Message = "Loop cycles must include an exit path to a node outside the loop.",
                });
            }
        }

        return issues;
    }

    private void ValidateSubWorkflowNode(
        WorkflowNodeDto node,
        IReadOnlyDictionary<string, WorkflowDefinitionDto>? workflowLibraryById,
        List<WorkflowValidationIssueDto> issues)
    {
        if (!string.Equals(node.Kind, "sub-workflow", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        bool hasWorkflowId = !string.IsNullOrWhiteSpace(node.Config.WorkflowId);
        bool hasInlineWorkflow = node.Config.InlineWorkflow is not null;
        if (hasWorkflowId == hasInlineWorkflow)
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.nodes.config",
                NodeId = node.Id,
                Message = "Sub-workflow nodes must specify exactly one of workflowId or inlineWorkflow.",
            });
            return;
        }

        if (hasWorkflowId
            && workflowLibraryById is not null
            && !workflowLibraryById.ContainsKey(node.Config.WorkflowId!))
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.nodes.config.workflowId",
                NodeId = node.Id,
                Message = $"Sub-workflow node \"{node.Label}\" references unknown workflow \"{node.Config.WorkflowId}\".",
            });
        }

        if (node.Config.InlineWorkflow is null)
        {
            return;
        }

        foreach (WorkflowValidationIssueDto inlineIssue in Validate(node.Config.InlineWorkflow, workflowLibraryById?.Values.ToList()))
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Level = inlineIssue.Level,
                Field = inlineIssue.Field is null
                    ? "graph.nodes.config.inlineWorkflow"
                    : $"graph.nodes.config.inlineWorkflow.{inlineIssue.Field}",
                NodeId = node.Id,
                EdgeId = inlineIssue.EdgeId,
                Message = $"Inline workflow for node \"{node.Label}\": {inlineIssue.Message}",
            });
        }
    }

    private static void ValidateEdgeCondition(WorkflowEdgeDto edge, List<WorkflowValidationIssueDto> issues)
    {
        if (edge.Condition is null)
        {
            return;
        }

        if (string.Equals(edge.Kind, "fan-in", StringComparison.OrdinalIgnoreCase))
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.edges.condition",
                EdgeId = edge.Id,
                Message = "Fan-in edges do not support conditions.",
            });
        }

        if (!WorkflowConditionEvaluator.IsSupportedConditionType(edge.Condition.Type))
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.edges.condition.type",
                EdgeId = edge.Id,
                Message = $"Condition type \"{edge.Condition.Type}\" is not supported.",
            });
            return;
        }

        if (string.Equals(edge.Condition.Type, "message-type", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrWhiteSpace(edge.Condition.TypeName))
        {
            issues.Add(new WorkflowValidationIssueDto
            {
                Field = "graph.edges.condition.typeName",
                EdgeId = edge.Id,
                Message = "Message-type conditions require a type name.",
            });
        }

        if (string.Equals(edge.Condition.Type, "expression", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(edge.Condition.Expression))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.condition.expression",
                    EdgeId = edge.Id,
                    Message = "Expression conditions require a non-empty expression.",
                });
            }
            else if (!WorkflowConditionEvaluator.IsSupportedExpression(edge.Condition.Expression))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.condition.expression",
                    EdgeId = edge.Id,
                    Message = "Expression conditions currently support simple comparisons using ==, !=, >, <, contains, matches, optionally combined with && or ||.",
                });
            }
        }

        if (string.Equals(edge.Condition.Type, "property", StringComparison.OrdinalIgnoreCase))
        {
            if (edge.Condition.Rules.Count == 0)
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.condition.rules",
                    EdgeId = edge.Id,
                    Message = "Property conditions require at least one rule.",
                });
            }

            if (!string.IsNullOrWhiteSpace(edge.Condition.Combinator)
                && !string.Equals(edge.Condition.Combinator, "and", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(edge.Condition.Combinator, "or", StringComparison.OrdinalIgnoreCase))
            {
                issues.Add(new WorkflowValidationIssueDto
                {
                    Field = "graph.edges.condition.combinator",
                    EdgeId = edge.Id,
                    Message = "Property conditions must use the \"and\" or \"or\" combinator.",
                });
            }

            foreach (WorkflowConditionRuleDto rule in edge.Condition.Rules)
            {
                if (string.IsNullOrWhiteSpace(rule.PropertyPath))
                {
                    issues.Add(new WorkflowValidationIssueDto
                    {
                        Field = "graph.edges.condition.rules.propertyPath",
                        EdgeId = edge.Id,
                        Message = "Property condition rules require a property path.",
                    });
                }

                if (!WorkflowConditionEvaluator.IsSupportedOperator(rule.Operator))
                {
                    issues.Add(new WorkflowValidationIssueDto
                    {
                        Field = "graph.edges.condition.rules.operator",
                        EdgeId = edge.Id,
                        Message = $"Property condition operator \"{rule.Operator}\" is not supported.",
                    });
                }

                if (string.Equals(rule.Operator, "regex", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        _ = new System.Text.RegularExpressions.Regex(rule.Value);
                    }
                    catch (ArgumentException)
                    {
                        issues.Add(new WorkflowValidationIssueDto
                        {
                            Field = "graph.edges.condition.rules.value",
                            EdgeId = edge.Id,
                            Message = $"Regex pattern \"{rule.Value}\" is invalid.",
                        });
                    }
                }
            }
        }
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

    private static bool CanReachNode(
        WorkflowGraphDto graph,
        string startNodeId,
        string targetNodeId,
        string? excludedEdgeId = null)
    {
        if (string.Equals(startNodeId, targetNodeId, StringComparison.Ordinal))
        {
            return true;
        }

        Dictionary<string, List<string>> outgoing = graph.Edges
            .Where(edge => !string.Equals(edge.Id, excludedEdgeId, StringComparison.Ordinal))
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

            foreach (string target in outgoing.GetValueOrDefault(current, []))
            {
                if (string.Equals(target, targetNodeId, StringComparison.Ordinal))
                {
                    return true;
                }

                queue.Enqueue(target);
            }
        }

        return false;
    }

    private static bool IsLoopEdge(WorkflowGraphDto graph, WorkflowEdgeDto edge)
        => CanReachNode(graph, edge.Target, edge.Source, edge.Id);

    private static HashSet<string> CollectStronglyConnectedNodes(WorkflowGraphDto graph, string nodeId)
    {
        HashSet<string> connected = new(StringComparer.Ordinal);
        foreach (WorkflowNodeDto candidate in graph.Nodes)
        {
            if (CanReachNode(graph, nodeId, candidate.Id) && CanReachNode(graph, candidate.Id, nodeId))
            {
                connected.Add(candidate.Id);
            }
        }

        return connected;
    }
}
