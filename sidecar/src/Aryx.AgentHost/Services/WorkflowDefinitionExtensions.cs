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

    public static bool IsOrchestrationMode(this WorkflowDefinitionDto workflow, string mode)
    {
        ArgumentNullException.ThrowIfNull(workflow);
        ArgumentException.ThrowIfNullOrWhiteSpace(mode);

        return string.Equals(workflow.Settings.OrchestrationMode, mode, StringComparison.OrdinalIgnoreCase);
    }

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
