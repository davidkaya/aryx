using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal static class WorkflowDefinitionExtensions
{
    public static IReadOnlyList<WorkflowNodeDto> GetAgentNodes(this WorkflowDefinitionDto workflow)
    {
        ArgumentNullException.ThrowIfNull(workflow);

        return workflow.Graph.Nodes
            .Where(IsAgentNode)
            .ToList();
    }

    public static IReadOnlyList<WorkflowNodeDto> GetAllAgentNodes(
        this WorkflowDefinitionDto workflow,
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary = null)
    {
        ArgumentNullException.ThrowIfNull(workflow);

        Dictionary<string, WorkflowDefinitionDto> workflowLibraryMap = CreateWorkflowLibraryMap(workflowLibrary);
        return GetAllAgentNodes(workflow, workflowLibraryMap);
    }

    public static IReadOnlyList<WorkflowNodeDto> GetAllAgentNodes(
        this WorkflowDefinitionDto workflow,
        IReadOnlyDictionary<string, WorkflowDefinitionDto>? workflowLibrary)
    {
        ArgumentNullException.ThrowIfNull(workflow);

        List<WorkflowNodeDto> agentNodes = [];
        CollectAgentNodes(
            workflow,
            workflowLibrary ?? EmptyWorkflowLibrary,
            agentNodes,
            new HashSet<string>(StringComparer.Ordinal),
            new HashSet<WorkflowDefinitionDto>(ReferenceEqualityComparer.Instance));
        return agentNodes;
    }

    public static bool IsAgentNode(this WorkflowNodeDto node)
    {
        ArgumentNullException.ThrowIfNull(node);
        return string.Equals(node.Kind, "agent", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsSubWorkflowNode(this WorkflowNodeDto node)
    {
        ArgumentNullException.ThrowIfNull(node);
        return string.Equals(node.Kind, "sub-workflow", StringComparison.OrdinalIgnoreCase);
    }

    public static string GetAgentId(this WorkflowNodeDto node)
    {
        ArgumentNullException.ThrowIfNull(node);
        return !string.IsNullOrWhiteSpace(node.Config.Id) ? node.Config.Id : node.Id;
    }

    public static string GetAgentName(this WorkflowNodeDto node)
    {
        ArgumentNullException.ThrowIfNull(node);
        return FirstNonBlank(node.Config.Name, node.Label, node.Id) ?? "agent";
    }

    public static WorkflowDefinitionDto ResolveSubWorkflowDefinition(
        this WorkflowNodeDto node,
        IReadOnlyDictionary<string, WorkflowDefinitionDto>? workflowLibrary)
    {
        return node.TryResolveSubWorkflowDefinition(workflowLibrary)
            ?? throw new InvalidOperationException(
                $"Sub-workflow node \"{node.Id}\" references unknown workflow \"{node.Config.WorkflowId}\".");
    }

    public static WorkflowDefinitionDto? TryResolveSubWorkflowDefinition(
        this WorkflowNodeDto node,
        IReadOnlyDictionary<string, WorkflowDefinitionDto>? workflowLibrary)
    {
        ArgumentNullException.ThrowIfNull(node);

        if (node.Config.InlineWorkflow is not null)
        {
            return node.Config.InlineWorkflow;
        }

        if (!string.IsNullOrWhiteSpace(node.Config.WorkflowId)
            && workflowLibrary is not null
            && workflowLibrary.TryGetValue(node.Config.WorkflowId, out WorkflowDefinitionDto? workflow))
        {
            return workflow;
        }

        return null;
    }

    public static bool IsOrchestrationMode(this WorkflowDefinitionDto workflow, string mode)
    {
        ArgumentNullException.ThrowIfNull(workflow);
        ArgumentException.ThrowIfNullOrWhiteSpace(mode);

        return string.Equals(workflow.Settings.OrchestrationMode, mode, StringComparison.OrdinalIgnoreCase);
    }

    public static WorkflowNodeDto? FindSubWorkflowNode(
        this WorkflowDefinitionDto workflow,
        string? nodeId,
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary = null)
    {
        ArgumentNullException.ThrowIfNull(workflow);
        string? normalizedNodeId = NormalizeOptionalString(nodeId);
        if (normalizedNodeId is null)
        {
            return null;
        }

        return FindSubWorkflowNode(
            workflow,
            normalizedNodeId,
            CreateWorkflowLibraryMap(workflowLibrary),
            new HashSet<string>(StringComparer.Ordinal),
            new HashSet<WorkflowDefinitionDto>(ReferenceEqualityComparer.Instance));
    }

    internal static WorkflowNodeDto? FindSubWorkflowNode(
        this WorkflowDefinitionDto workflow,
        string? nodeId,
        IReadOnlyDictionary<string, WorkflowDefinitionDto>? workflowLibrary)
    {
        ArgumentNullException.ThrowIfNull(workflow);
        string? normalizedNodeId = NormalizeOptionalString(nodeId);
        if (normalizedNodeId is null)
        {
            return null;
        }

        return FindSubWorkflowNode(
            workflow,
            normalizedNodeId,
            workflowLibrary ?? EmptyWorkflowLibrary,
            new HashSet<string>(StringComparer.Ordinal),
            new HashSet<WorkflowDefinitionDto>(ReferenceEqualityComparer.Instance));
    }

    internal static string GetSubworkflowDisplayName(
        this WorkflowNodeDto node,
        IReadOnlyDictionary<string, WorkflowDefinitionDto>? workflowLibrary)
    {
        ArgumentNullException.ThrowIfNull(node);

        WorkflowDefinitionDto? resolvedWorkflow = null;
        if (node.Config.InlineWorkflow is not null)
        {
            resolvedWorkflow = node.Config.InlineWorkflow;
        }
        else if (!string.IsNullOrWhiteSpace(node.Config.WorkflowId)
                 && workflowLibrary is not null
                 && workflowLibrary.TryGetValue(node.Config.WorkflowId, out WorkflowDefinitionDto? workflow))
        {
            resolvedWorkflow = workflow;
        }

        return FirstNonBlank(node.Label, resolvedWorkflow?.Name, node.Config.WorkflowId, node.Id) ?? "sub-workflow";
    }

    private static readonly IReadOnlyDictionary<string, WorkflowDefinitionDto> EmptyWorkflowLibrary =
        new Dictionary<string, WorkflowDefinitionDto>(StringComparer.Ordinal);

    private static void CollectAgentNodes(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        List<WorkflowNodeDto> agentNodes,
        ISet<string> visitedWorkflowIds,
        ISet<WorkflowDefinitionDto> visitedAnonymousWorkflows)
    {
        string? workflowId = NormalizeOptionalString(workflowDefinition.Id);
        if (workflowId is not null)
        {
            if (!visitedWorkflowIds.Add(workflowId))
            {
                return;
            }
        }
        else if (!visitedAnonymousWorkflows.Add(workflowDefinition))
        {
            return;
        }

        foreach (WorkflowNodeDto node in workflowDefinition.Graph.Nodes)
        {
            if (node.IsAgentNode())
            {
                agentNodes.Add(node);
                continue;
            }

            if (!string.Equals(node.Kind, "sub-workflow", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            WorkflowDefinitionDto? subWorkflow = node.TryResolveSubWorkflowDefinition(workflowLibrary);
            if (subWorkflow is not null)
            {
                CollectAgentNodes(subWorkflow, workflowLibrary, agentNodes, visitedWorkflowIds, visitedAnonymousWorkflows);
            }
        }
    }

    private static WorkflowNodeDto? FindSubWorkflowNode(
        WorkflowDefinitionDto workflowDefinition,
        string nodeId,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        ISet<string> visitedWorkflowIds,
        ISet<WorkflowDefinitionDto> visitedAnonymousWorkflows)
    {
        string? workflowId = NormalizeOptionalString(workflowDefinition.Id);
        if (workflowId is not null)
        {
            if (!visitedWorkflowIds.Add(workflowId))
            {
                return null;
            }
        }
        else if (!visitedAnonymousWorkflows.Add(workflowDefinition))
        {
            return null;
        }

        foreach (WorkflowNodeDto node in workflowDefinition.Graph.Nodes)
        {
            if (!node.IsSubWorkflowNode())
            {
                continue;
            }

            if (string.Equals(node.Id, nodeId, StringComparison.OrdinalIgnoreCase))
            {
                return node;
            }

            WorkflowDefinitionDto? subWorkflow = node.TryResolveSubWorkflowDefinition(workflowLibrary);
            if (subWorkflow is null)
            {
                continue;
            }

            WorkflowNodeDto? match = FindSubWorkflowNode(
                subWorkflow,
                nodeId,
                workflowLibrary,
                visitedWorkflowIds,
                visitedAnonymousWorkflows);
            if (match is not null)
            {
                return match;
            }
        }

        return null;
    }

    internal static Dictionary<string, WorkflowDefinitionDto> CreateWorkflowLibraryMap(
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary)
    {
        return workflowLibrary?
            .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Id))
            .GroupBy(candidate => candidate.Id, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Last(), StringComparer.Ordinal)
            ?? new Dictionary<string, WorkflowDefinitionDto>(StringComparer.Ordinal);
    }

    private static string? NormalizeOptionalString(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string? FirstNonBlank(params string?[] values)
    {
        foreach (string? value in values)
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value.Trim();
            }
        }

        return null;
    }
}
