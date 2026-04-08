using System.Text;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal readonly record struct SubworkflowContext(string SubworkflowNodeId, string SubworkflowName);

internal readonly record struct AgentIdentity(
    string AgentId,
    string AgentName,
    SubworkflowContext? Subworkflow = null);

internal static class AgentIdentityResolver
{
    private const string GenericAssistantIdentifier = "assistant";

    public static bool TryResolveKnownAgentIdentity(
        WorkflowDefinitionDto workflow,
        string? agentIdentifier,
        out AgentIdentity agent)
    {
        return TryResolveKnownAgentIdentity(
            workflow,
            WorkflowDefinitionExtensions.CreateWorkflowLibraryMap(null),
            agentIdentifier,
            agentSubworkflowIndex: null,
            out agent);
    }

    public static bool TryResolveKnownAgentIdentity(
        WorkflowDefinitionDto workflow,
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary,
        string? agentIdentifier,
        out AgentIdentity agent)
    {
        return TryResolveKnownAgentIdentity(
            workflow,
            WorkflowDefinitionExtensions.CreateWorkflowLibraryMap(workflowLibrary),
            agentIdentifier,
            agentSubworkflowIndex: null,
            out agent);
    }

    internal static bool TryResolveKnownAgentIdentity(
        WorkflowDefinitionDto workflow,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        string? agentIdentifier,
        IReadOnlyDictionary<string, SubworkflowContext>? agentSubworkflowIndex,
        out AgentIdentity agent)
    {
        agent = default;

        WorkflowNodeDto? shallowMatch = FindKnownAgent(workflow.GetAgentNodes(), agentIdentifier);
        if (shallowMatch is not null)
        {
            agent = ToAgentIdentity(shallowMatch);
            return true;
        }

        WorkflowNodeDto? deepMatch = FindKnownAgent(workflow.GetAllAgentNodes(workflowLibrary), agentIdentifier);
        if (deepMatch is not null)
        {
            IReadOnlyDictionary<string, SubworkflowContext> subworkflowIndex = agentSubworkflowIndex
                ?? BuildAgentSubworkflowIndex(workflow, workflowLibrary);
            agent = ToAgentIdentity(deepMatch, subworkflowIndex);
            return true;
        }

        WorkflowNodeDto? aliasMatch = ResolveSingleAgentAssistantAlias(workflow, workflowLibrary, agentIdentifier);
        if (aliasMatch is null)
        {
            return false;
        }

        if (workflow.GetAgentNodes().Contains(aliasMatch))
        {
            agent = ToAgentIdentity(aliasMatch);
            return true;
        }

        IReadOnlyDictionary<string, SubworkflowContext> aliasSubworkflowIndex = agentSubworkflowIndex
            ?? BuildAgentSubworkflowIndex(workflow, workflowLibrary);
        agent = ToAgentIdentity(aliasMatch, aliasSubworkflowIndex);
        return true;
    }

    public static bool TryResolveObservedAgentIdentity(
        WorkflowDefinitionDto workflow,
        string? agentIdentifier,
        AgentIdentity? fallbackAgent,
        out AgentIdentity agent)
    {
        return TryResolveObservedAgentIdentity(
            workflow,
            WorkflowDefinitionExtensions.CreateWorkflowLibraryMap(null),
            agentIdentifier,
            fallbackAgent,
            agentSubworkflowIndex: null,
            out agent);
    }

    internal static bool TryResolveObservedAgentIdentity(
        WorkflowDefinitionDto workflow,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        string? agentIdentifier,
        AgentIdentity? fallbackAgent,
        IReadOnlyDictionary<string, SubworkflowContext>? agentSubworkflowIndex,
        out AgentIdentity agent)
    {
        if (TryResolveKnownAgentIdentity(workflow, workflowLibrary, agentIdentifier, agentSubworkflowIndex, out agent))
        {
            return true;
        }

        if (fallbackAgent.HasValue && IsGenericAssistantIdentifier(agentIdentifier))
        {
            agent = fallbackAgent.Value;
            return true;
        }

        agent = default;
        return false;
    }

    public static AgentIdentity ResolveAgentIdentity(
        WorkflowDefinitionDto workflow,
        string? agentId,
        string? agentName)
    {
        return ResolveAgentIdentity(
            workflow,
            WorkflowDefinitionExtensions.CreateWorkflowLibraryMap(null),
            agentId,
            agentName,
            agentSubworkflowIndex: null);
    }

    public static AgentIdentity ResolveAgentIdentity(
        WorkflowDefinitionDto workflow,
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary,
        string? agentId,
        string? agentName)
    {
        return ResolveAgentIdentity(
            workflow,
            WorkflowDefinitionExtensions.CreateWorkflowLibraryMap(workflowLibrary),
            agentId,
            agentName,
            agentSubworkflowIndex: null);
    }

    internal static AgentIdentity ResolveAgentIdentity(
        WorkflowDefinitionDto workflow,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        string? agentId,
        string? agentName,
        IReadOnlyDictionary<string, SubworkflowContext>? agentSubworkflowIndex)
    {
        if (TryResolveKnownAgentIdentity(workflow, workflowLibrary, agentId, agentSubworkflowIndex, out AgentIdentity resolvedById))
        {
            return resolvedById;
        }

        if (TryResolveKnownAgentIdentity(workflow, workflowLibrary, agentName, agentSubworkflowIndex, out AgentIdentity resolvedByName))
        {
            return resolvedByName;
        }

        return CreateFallbackIdentity(agentId, agentName, agentSubworkflowIndex);
    }

    public static string ResolveDisplayAuthorName(
        WorkflowDefinitionDto workflow,
        string? primaryIdentifier,
        string? fallbackIdentifier = null)
    {
        if (TryResolveKnownAgentIdentity(workflow, primaryIdentifier, out AgentIdentity primaryAgent))
        {
            return primaryAgent.AgentName;
        }

        if (TryResolveKnownAgentIdentity(workflow, fallbackIdentifier, out AgentIdentity fallbackAgent))
        {
            return fallbackAgent.AgentName;
        }

        if (!string.IsNullOrWhiteSpace(primaryIdentifier))
        {
            return primaryIdentifier;
        }

        if (!string.IsNullOrWhiteSpace(fallbackIdentifier))
        {
            return fallbackIdentifier;
        }

        return GenericAssistantIdentifier;
    }

    public static IReadOnlyDictionary<string, SubworkflowContext> BuildAgentSubworkflowIndex(
        WorkflowDefinitionDto workflow,
        IReadOnlyList<WorkflowDefinitionDto>? workflowLibrary = null)
    {
        return BuildAgentSubworkflowIndex(
            workflow,
            WorkflowDefinitionExtensions.CreateWorkflowLibraryMap(workflowLibrary));
    }

    internal static IReadOnlyDictionary<string, SubworkflowContext> BuildAgentSubworkflowIndex(
        WorkflowDefinitionDto workflow,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary)
    {
        ArgumentNullException.ThrowIfNull(workflow);
        ArgumentNullException.ThrowIfNull(workflowLibrary);

        Dictionary<string, SubworkflowContext> index = new(StringComparer.Ordinal);
        CollectAgentSubworkflowContexts(
            workflow,
            workflowLibrary,
            currentSubworkflow: null,
            index,
            new HashSet<string>(StringComparer.Ordinal),
            new HashSet<WorkflowDefinitionDto>(ReferenceEqualityComparer.Instance));
        return index;
    }

    internal static bool TryResolveSubworkflowContext(
        WorkflowDefinitionDto workflow,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        string? subworkflowNodeId,
        out SubworkflowContext context)
    {
        ArgumentNullException.ThrowIfNull(workflow);
        ArgumentNullException.ThrowIfNull(workflowLibrary);

        context = default;
        WorkflowNodeDto? node = workflow.FindSubWorkflowNode(subworkflowNodeId, workflowLibrary);
        if (node is null)
        {
            return false;
        }

        context = CreateSubworkflowContext(node, workflowLibrary);
        return true;
    }

    internal static bool IsGenericAssistantIdentifier(string? candidate)
    {
        return string.Equals(
            NormalizeComparisonKey(candidate),
            GenericAssistantIdentifier,
            StringComparison.Ordinal);
    }

    private static WorkflowNodeDto? ResolveSingleAgentAssistantAlias(
        WorkflowDefinitionDto workflow,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        params string?[] agentIdentifiers)
    {
        if (!agentIdentifiers.Any(IsGenericAssistantIdentifier))
        {
            return null;
        }

        IReadOnlyList<WorkflowNodeDto> topLevelAgents = workflow.GetAgentNodes();
        if (topLevelAgents.Count == 1)
        {
            return topLevelAgents[0];
        }

        IReadOnlyList<WorkflowNodeDto> allAgents = workflow.GetAllAgentNodes(workflowLibrary);
        return allAgents.Count == 1 ? allAgents[0] : null;
    }

    private static WorkflowNodeDto? FindKnownAgent(
        IEnumerable<WorkflowNodeDto> agents,
        string? candidate)
    {
        return agents.FirstOrDefault(agent => MatchesAgent(agent, candidate));
    }

    private static AgentIdentity ToAgentIdentity(WorkflowNodeDto agent)
        => new(agent.GetAgentId(), agent.GetAgentName());

    private static AgentIdentity ToAgentIdentity(
        WorkflowNodeDto agent,
        IReadOnlyDictionary<string, SubworkflowContext> agentSubworkflowIndex)
    {
        string agentId = agent.GetAgentId();
        return agentSubworkflowIndex.TryGetValue(agentId, out SubworkflowContext subworkflow)
            ? new AgentIdentity(agentId, agent.GetAgentName(), subworkflow)
            : new AgentIdentity(agentId, agent.GetAgentName());
    }

    private static AgentIdentity CreateFallbackIdentity(
        string? agentId,
        string? agentName,
        IReadOnlyDictionary<string, SubworkflowContext>? agentSubworkflowIndex)
    {
        string resolvedAgentId = NormalizeOptionalString(agentId)
            ?? NormalizeOptionalString(agentName)
            ?? "agent";
        string resolvedAgentName = NormalizeOptionalString(agentName)
            ?? resolvedAgentId;

        if (agentSubworkflowIndex is not null
            && agentSubworkflowIndex.TryGetValue(resolvedAgentId, out SubworkflowContext subworkflow))
        {
            return new AgentIdentity(resolvedAgentId, resolvedAgentName, subworkflow);
        }

        return new AgentIdentity(resolvedAgentId, resolvedAgentName);
    }

    private static void CollectAgentSubworkflowContexts(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary,
        SubworkflowContext? currentSubworkflow,
        Dictionary<string, SubworkflowContext> index,
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
                if (currentSubworkflow.HasValue)
                {
                    index[node.GetAgentId()] = currentSubworkflow.Value;
                }

                continue;
            }

            if (!node.IsSubWorkflowNode())
            {
                continue;
            }

            WorkflowDefinitionDto? subWorkflow = node.TryResolveSubWorkflowDefinition(workflowLibrary);
            if (subWorkflow is null)
            {
                continue;
            }

            CollectAgentSubworkflowContexts(
                subWorkflow,
                workflowLibrary,
                CreateSubworkflowContext(node, workflowLibrary),
                index,
                visitedWorkflowIds,
                visitedAnonymousWorkflows);
        }
    }

    private static SubworkflowContext CreateSubworkflowContext(
        WorkflowNodeDto node,
        IReadOnlyDictionary<string, WorkflowDefinitionDto> workflowLibrary)
    {
        return new SubworkflowContext(node.Id, node.GetSubworkflowDisplayName(workflowLibrary));
    }

    private static bool MatchesAgent(WorkflowNodeDto agent, string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return false;
        }

        string agentId = agent.GetAgentId();
        string agentName = agent.GetAgentName();
        if (string.Equals(agentId, candidate, StringComparison.OrdinalIgnoreCase)
            || string.Equals(agentName, candidate, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        string normalizedCandidate = NormalizeComparisonKey(candidate);
        string normalizedId = NormalizeComparisonKey(agentId);
        string normalizedName = NormalizeComparisonKey(agentName);
        if (normalizedCandidate.Length == 0)
        {
            return false;
        }

        if (normalizedCandidate == normalizedId
            || normalizedCandidate == normalizedName)
        {
            return true;
        }

        return normalizedId.Length > 0
            && normalizedName.Length > 0
            && (normalizedCandidate.EndsWith(normalizedId, StringComparison.Ordinal)
                || normalizedCandidate.Contains(normalizedId, StringComparison.Ordinal)
                    && normalizedCandidate.Contains(normalizedName, StringComparison.Ordinal));
    }

    private static string? NormalizeOptionalString(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string NormalizeComparisonKey(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        StringBuilder builder = new(value.Length);
        foreach (char character in value)
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(char.ToLowerInvariant(character));
            }
        }

        return builder.ToString();
    }
}
