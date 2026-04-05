using Aryx.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Agents.AI.Workflows.Specialized;

namespace Aryx.AgentHost.Services;

internal sealed class WorkflowRunner
{
    public Workflow BuildWorkflow(
        WorkflowDefinitionDto workflowDefinition,
        PatternDefinitionDto patternDefinition,
        IReadOnlyList<AIAgent> agents)
    {
        ArgumentNullException.ThrowIfNull(workflowDefinition);
        ArgumentNullException.ThrowIfNull(patternDefinition);
        ArgumentNullException.ThrowIfNull(agents);

        WorkflowNodeDto startNode = workflowDefinition.Graph.Nodes.Single(node =>
            string.Equals(node.Kind, "start", StringComparison.OrdinalIgnoreCase));
        WorkflowNodeDto endNode = workflowDefinition.Graph.Nodes.Single(node =>
            string.Equals(node.Kind, "end", StringComparison.OrdinalIgnoreCase));

        Dictionary<string, AIAgent> agentMap = patternDefinition.Agents
            .Zip(agents, (definition, agent) => (definition.Id, agent))
            .ToDictionary(pair => pair.Id, pair => pair.agent, StringComparer.Ordinal);

        Dictionary<string, ExecutorBinding> bindings = new(StringComparer.Ordinal);
        foreach (WorkflowNodeDto node in workflowDefinition.Graph.Nodes)
        {
            bindings[node.Id] = CreateExecutorBinding(node, agentMap);
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
        IReadOnlyDictionary<string, AIAgent> agentMap)
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

        throw new NotSupportedException($"Workflow node kind \"{node.Kind}\" is not executable yet.");
    }
}
