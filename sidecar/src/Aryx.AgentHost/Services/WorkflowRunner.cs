using Aryx.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;

namespace Aryx.AgentHost.Services;

internal sealed class WorkflowRunner
{
    public Workflow BuildWorkflow(
        WorkflowDefinitionDto workflowDefinition,
        PatternDefinitionDto patternDefinition,
        IReadOnlyList<AIAgent> agents,
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary = null)
    {
        ArgumentNullException.ThrowIfNull(workflowDefinition);
        ArgumentNullException.ThrowIfNull(patternDefinition);
        ArgumentNullException.ThrowIfNull(agents);

        Dictionary<string, WorkflowDefinitionDto> workflowLibraryMap = workflowLibrary?
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Id))
            .GroupBy(candidate => candidate.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Last(), StringComparer.Ordinal)
            ?? new Dictionary<string, WorkflowDefinitionDto>(StringComparer.Ordinal);

        WorkflowNodeDto startNode = workflowDefinition.Graph.Nodes.Single(node =>
            string.Equals(node.Kind, "start", StringComparison.OrdinalIgnoreCase));
        WorkflowNodeDto endNode = workflowDefinition.Graph.Nodes.Single(node =>
            string.Equals(node.Kind, "end", StringComparison.OrdinalIgnoreCase));

        Dictionary<string, AIAgent> agentMap = patternDefinition.Agents
            .Zip(agents, (definition, agent) => (definition.Id, agent))
            .ToDictionary(pair => pair.Id, pair => pair.agent, StringComparer.Ordinal);

        return BuildWorkflow(workflowDefinition, agentMap, workflowLibraryMap);
    }

    private Workflow BuildWorkflow(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyDictionary<string, AIAgent> agentMap,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary)
    {
        WorkflowNodeDto startNode = workflowDefinition.Graph.Nodes.Single(node =>
            string.Equals(node.Kind, "start", StringComparison.OrdinalIgnoreCase));
        WorkflowNodeDto endNode = workflowDefinition.Graph.Nodes.Single(node =>
            string.Equals(node.Kind, "end", StringComparison.OrdinalIgnoreCase));

        Dictionary<string, ExecutorBinding> bindings = new(StringComparer.Ordinal);
        foreach (WorkflowNodeDto node in workflowDefinition.Graph.Nodes)
        {
            bindings[node.Id] = CreateExecutorBinding(node, agentMap, workflowLibrary);
        }

        WorkflowBuilder builder = new(bindings[startNode.Id]);

        foreach (WorkflowEdgeDto edge in workflowDefinition.Graph.Edges.Where(edge =>
                     string.Equals(edge.Kind, "direct", StringComparison.OrdinalIgnoreCase)))
        {
            Func<object?, bool>? condition = WorkflowConditionEvaluator.Compile(edge);
            if (condition is null)
            {
                builder.AddEdge(bindings[edge.Source], bindings[edge.Target]);
            }
            else
            {
                builder.AddEdge<object>(bindings[edge.Source], bindings[edge.Target], condition);
            }
        }

        foreach (IGrouping<string, WorkflowEdgeDto> fanOutGroup in workflowDefinition.Graph.Edges
                     .Where(edge => string.Equals(edge.Kind, "fan-out", StringComparison.OrdinalIgnoreCase))
                     .GroupBy(edge => edge.Source, StringComparer.Ordinal))
        {
            WorkflowEdgeDto[] fanOutEdges = fanOutGroup.ToArray();
            ExecutorBinding[] targets = fanOutEdges.Select(edge => bindings[edge.Target]).ToArray();
            Func<object?, bool>?[] compiledConditions = fanOutEdges
                .Select(WorkflowConditionEvaluator.Compile)
                .ToArray();
            bool hasConditionalRouting = fanOutEdges.Any(edge => edge.Condition is not null);
            if (!hasConditionalRouting)
            {
                builder.AddFanOutEdge(bindings[fanOutGroup.Key], targets);
                continue;
            }

            builder.AddFanOutEdge<object>(
                bindings[fanOutGroup.Key],
                targets,
                (payload, _) => fanOutEdges
                    .Select((edge, index) => (edge, index))
                    .Where(pair => compiledConditions[pair.index]?.Invoke(payload) ?? true)
                    .Select(pair => pair.index)
                    .ToArray());
        }

        foreach (IGrouping<string, WorkflowEdgeDto> fanInGroup in workflowDefinition.Graph.Edges
                     .Where(edge => string.Equals(edge.Kind, "fan-in", StringComparison.OrdinalIgnoreCase))
                     .GroupBy(edge => edge.Target, StringComparer.Ordinal))
        {
            builder.AddFanInBarrierEdge(
                fanInGroup.Select(edge => bindings[edge.Source]).ToArray(),
                bindings[fanInGroup.Key]);
        }

        if (!string.IsNullOrWhiteSpace(workflowDefinition.Name))
        {
            builder = builder.WithName(workflowDefinition.Name);
        }

        return builder.WithOutputFrom(bindings[endNode.Id]).Build();
    }

    private static ExecutorBinding CreateExecutorBinding(
        WorkflowNodeDto node,
        IReadOnlyDictionary<string, AIAgent> agentMap,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary)
    {
        if (string.Equals(node.Kind, "start", StringComparison.OrdinalIgnoreCase))
        {
            return new ChatForwardingExecutor(node.Id);
        }

        if (string.Equals(node.Kind, "end", StringComparison.OrdinalIgnoreCase))
        {
            return new WorkflowOutputMessagesExecutor();
        }

        if (string.Equals(node.Kind, "agent", StringComparison.OrdinalIgnoreCase))
        {
            string agentId = !string.IsNullOrWhiteSpace(node.Config.Id) ? node.Config.Id : node.Id;
            if (!agentMap.TryGetValue(agentId, out AIAgent? agent))
            {
                throw new InvalidOperationException($"Workflow node \"{node.Id}\" references unknown agent \"{agentId}\".");
            }

            return agent.BindAsExecutor(CopilotAgentBundle.CreateAgentHostOptions());
        }

        if (string.Equals(node.Kind, "sub-workflow", StringComparison.OrdinalIgnoreCase))
        {
            WorkflowDefinitionDto subWorkflowDefinition = ResolveSubWorkflowDefinition(node, workflowLibrary);
            Workflow subWorkflow = new WorkflowRunner().BuildWorkflow(subWorkflowDefinition, agentMap, workflowLibrary);
            return subWorkflow.BindAsExecutor(node.Id);
        }

        throw new NotSupportedException($"Workflow node kind \"{node.Kind}\" is not executable yet.");
    }

    private static WorkflowDefinitionDto ResolveSubWorkflowDefinition(
        WorkflowNodeDto node,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary)
    {
        if (node.Config.InlineWorkflow is not null)
        {
            return node.Config.InlineWorkflow;
        }

        if (!string.IsNullOrWhiteSpace(node.Config.WorkflowId)
            && workflowLibrary.TryGetValue(node.Config.WorkflowId, out WorkflowDefinitionDto? workflow))
        {
            return workflow;
        }

        throw new InvalidOperationException(
            $"Sub-workflow node \"{node.Id}\" references unknown workflow \"{node.Config.WorkflowId}\".");
    }
}
