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

        throw new InvalidOperationException(
            $"Sub-workflow node \"{node.Id}\" references unknown workflow \"{node.Config.WorkflowId}\".");
    }

    public static bool IsOrchestrationMode(this WorkflowDefinitionDto workflow, string mode)
    {
        ArgumentNullException.ThrowIfNull(workflow);
        ArgumentException.ThrowIfNullOrWhiteSpace(mode);

        return string.Equals(workflow.Settings.OrchestrationMode, mode, StringComparison.OrdinalIgnoreCase);
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

            WorkflowDefinitionDto subWorkflow = node.ResolveSubWorkflowDefinition(workflowLibrary);
            CollectAgentNodes(subWorkflow, workflowLibrary, agentNodes, visitedWorkflowIds, visitedAnonymousWorkflows);
        }
    }

    private static Dictionary<string, WorkflowDefinitionDto> CreateWorkflowLibraryMap(
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
