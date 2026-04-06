using Aryx.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;

namespace Aryx.AgentHost.Services;

internal sealed class WorkflowRunner
{
    public Workflow BuildWorkflow(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyList<AIAgent> agents,
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary = null)
    {
        ArgumentNullException.ThrowIfNull(workflowDefinition);
        ArgumentNullException.ThrowIfNull(agents);

        Dictionary<string, WorkflowDefinitionDto> workflowLibraryMap = workflowLibrary?
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Id))
            .GroupBy(candidate => candidate.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Last(), StringComparer.Ordinal)
            ?? new Dictionary<string, WorkflowDefinitionDto>(StringComparer.Ordinal);

        List<string> agentIds = ResolveAgentIds(workflowDefinition, workflowLibraryMap);
        Dictionary<string, AIAgent> agentMap = agentIds
            .Zip(agents, (agentId, agent) => (agentId, agent))
            .ToDictionary(pair => pair.agentId, pair => pair.agent, StringComparer.Ordinal);

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
        WorkflowStateScopeCatalog stateCatalog = new(workflowDefinition.Settings.StateScopes);

        Dictionary<string, WorkflowNodeRoute> routes = new(StringComparer.Ordinal);
        foreach (WorkflowNodeDto node in workflowDefinition.Graph.Nodes)
        {
            routes[node.Id] = CreateNodeRoute(node, agentMap, workflowLibrary, stateCatalog);
        }

        WorkflowBuilder builder = new(routes[startNode.Id].Entry);

        foreach (WorkflowNodeRoute route in routes.Values)
        {
            foreach ((ExecutorBinding source, ExecutorBinding target) in route.InternalEdges)
            {
                builder.AddEdge(source, target);
            }
        }

        foreach (WorkflowEdgeDto edge in workflowDefinition.Graph.Edges.Where(edge =>
                     string.Equals(edge.Kind, "direct", StringComparison.OrdinalIgnoreCase)))
        {
            Func<object?, bool>? condition = WorkflowConditionEvaluator.Compile(edge);
            ExecutorBinding source = routes[edge.Source].Exit;
            ExecutorBinding target = routes[edge.Target].Entry;
            if (condition is null)
            {
                builder.AddEdge(source, target);
            }
            else
            {
                builder.AddEdge<object>(source, target, condition);
            }
        }

        foreach (IGrouping<string, WorkflowEdgeDto> fanOutGroup in workflowDefinition.Graph.Edges
                     .Where(edge => string.Equals(edge.Kind, "fan-out", StringComparison.OrdinalIgnoreCase))
                     .GroupBy(edge => edge.Source, StringComparer.Ordinal))
        {
            WorkflowEdgeDto[] fanOutEdges = fanOutGroup.ToArray();
            ExecutorBinding source = routes[fanOutGroup.Key].Exit;
            ExecutorBinding[] targets = fanOutEdges.Select(edge => routes[edge.Target].Entry).ToArray();
            Func<object?, bool>?[] compiledConditions = fanOutEdges
                .Select(WorkflowConditionEvaluator.Compile)
                .ToArray();
            bool hasConditionalRouting = fanOutEdges.Any(edge => edge.Condition is not null);
            if (!hasConditionalRouting)
            {
                builder.AddFanOutEdge(source, targets);
                continue;
            }

            builder.AddFanOutEdge<object>(
                source,
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
                fanInGroup.Select(edge => routes[edge.Source].Exit).ToArray(),
                routes[fanInGroup.Key].Entry);
        }

        if (!string.IsNullOrWhiteSpace(workflowDefinition.Name))
        {
            builder = builder.WithName(workflowDefinition.Name);
        }

        return builder.WithOutputFrom(routes[endNode.Id].Exit).Build();
    }

    private WorkflowNodeRoute CreateNodeRoute(
        WorkflowNodeDto node,
        IReadOnlyDictionary<string, AIAgent> agentMap,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        WorkflowStateScopeCatalog stateCatalog)
    {
        if (string.Equals(node.Kind, "start", StringComparison.OrdinalIgnoreCase))
        {
            ExecutorBinding binding = new ChatForwardingExecutor(node.Id).BindExecutor();
            return new WorkflowNodeRoute(binding);
        }

        if (string.Equals(node.Kind, "end", StringComparison.OrdinalIgnoreCase))
        {
            ExecutorBinding binding = new WorkflowOutputMessagesExecutor(node.Id).BindExecutor();
            return new WorkflowNodeRoute(binding);
        }

        if (string.Equals(node.Kind, "agent", StringComparison.OrdinalIgnoreCase))
        {
            string agentId = !string.IsNullOrWhiteSpace(node.Config.Id) ? node.Config.Id : node.Id;
            if (!agentMap.TryGetValue(agentId, out AIAgent? agent))
            {
                throw new InvalidOperationException($"Workflow node \"{node.Id}\" references unknown agent \"{agentId}\".");
            }

            return new WorkflowNodeRoute(agent.BindAsExecutor(CopilotAgentBundle.CreateAgentHostOptions()));
        }

        if (string.Equals(node.Kind, "code-executor", StringComparison.OrdinalIgnoreCase))
        {
            string implementation = NormalizeRequired(node.Config.Implementation, $"Workflow code executor \"{node.Id}\" requires an implementation.");
            ExecutorBinding binding = new WorkflowCodeExecutor(node.Id, implementation, stateCatalog).BindExecutor();
            return new WorkflowNodeRoute(binding);
        }

        if (string.Equals(node.Kind, "function-executor", StringComparison.OrdinalIgnoreCase))
        {
            string functionRef = NormalizeRequired(node.Config.FunctionRef, $"Workflow function executor \"{node.Id}\" requires a functionRef.");
            if (!WorkflowFunctionRegistry.IsSupported(functionRef))
            {
                throw new InvalidOperationException(
                    $"Workflow function executor \"{node.Id}\" references unsupported functionRef \"{functionRef}\".");
            }

            ExecutorBinding binding = new WorkflowFunctionExecutor(node.Id, functionRef, node.Config.Parameters, stateCatalog).BindExecutor();
            return new WorkflowNodeRoute(binding);
        }

        if (string.Equals(node.Kind, "request-port", StringComparison.OrdinalIgnoreCase))
        {
            return CreateRequestPortRoute(node);
        }

        if (string.Equals(node.Kind, "sub-workflow", StringComparison.OrdinalIgnoreCase))
        {
            WorkflowDefinitionDto subWorkflowDefinition = ResolveSubWorkflowDefinition(node, workflowLibrary);
            Workflow subWorkflow = BuildWorkflow(subWorkflowDefinition, agentMap, workflowLibrary);
            return new WorkflowNodeRoute(subWorkflow.BindAsExecutor(node.Id));
        }

        throw new NotSupportedException($"Workflow node kind \"{node.Kind}\" is not executable yet.");
    }

    private static WorkflowNodeRoute CreateRequestPortRoute(WorkflowNodeDto node)
    {
        WorkflowRequestPortNodeDefinition definition = new(
            node.Id,
            NormalizeOptionalString(node.Label) ?? node.Id,
            NormalizeRequired(node.Config.PortId, $"Workflow request port \"{node.Id}\" requires a portId."),
            NormalizeRequired(node.Config.RequestType, $"Workflow request port \"{node.Id}\" requires a requestType."),
            NormalizeRequired(node.Config.ResponseType, $"Workflow request port \"{node.Id}\" requires a responseType."),
            NormalizeOptionalString(node.Config.Prompt));

        RequestPort port = new(definition.PortId, typeof(WorkflowRequestPortPromptRequest), typeof(object));
        ExecutorBinding entry = new WorkflowRequestPortIngressExecutor(definition, port).BindExecutor();
        ExecutorBinding portBinding = new RequestPortBinding(port, false);
        ExecutorBinding exit = new WorkflowRequestPortResponseExecutor(node.Id).BindExecutor();
        return new WorkflowNodeRoute(entry, exit, [(entry, portBinding), (portBinding, exit)]);
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

    private static string NormalizeRequired(string? value, string errorMessage)
        => NormalizeOptionalString(value) ?? throw new InvalidOperationException(errorMessage);

    private static string? NormalizeOptionalString(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static List<string> ResolveAgentIds(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary)
    {
        List<string> agentIds = [];
        CollectAgentIds(workflowDefinition, workflowLibrary, agentIds, new HashSet<string>(StringComparer.Ordinal));
        return agentIds;
    }

    private static void CollectAgentIds(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        List<string> agentIds,
        ISet<string> visitedWorkflowIds)
    {
        string workflowKey = string.IsNullOrWhiteSpace(workflowDefinition.Id)
            ? Guid.NewGuid().ToString("N")
            : workflowDefinition.Id;
        if (!visitedWorkflowIds.Add(workflowKey))
        {
            return;
        }

        foreach (WorkflowNodeDto node in workflowDefinition.Graph.Nodes)
        {
            if (string.Equals(node.Kind, "agent", StringComparison.OrdinalIgnoreCase))
            {
                agentIds.Add(!string.IsNullOrWhiteSpace(node.Config.Id) ? node.Config.Id : node.Id);
                continue;
            }

            if (!string.Equals(node.Kind, "sub-workflow", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            WorkflowDefinitionDto subWorkflow = ResolveSubWorkflowDefinition(node, workflowLibrary);
            CollectAgentIds(subWorkflow, workflowLibrary, agentIds, visitedWorkflowIds);
        }
    }

    private sealed record WorkflowNodeRoute(
        ExecutorBinding Entry,
        ExecutorBinding Exit,
        IReadOnlyList<(ExecutorBinding Source, ExecutorBinding Target)> InternalEdges)
    {
        public WorkflowNodeRoute(ExecutorBinding binding)
            : this(binding, binding, [])
        {
        }
    }
}
