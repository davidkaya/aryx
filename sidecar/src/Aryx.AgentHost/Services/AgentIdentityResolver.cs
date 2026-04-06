using System.Text;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal readonly record struct AgentIdentity(string AgentId, string AgentName);

internal static class AgentIdentityResolver
{
    private const string GenericAssistantIdentifier = "assistant";

    public static bool TryResolveKnownAgentIdentity(
        WorkflowDefinitionDto workflow,
        string? agentIdentifier,
        out AgentIdentity agent)
    {
        agent = default;

        WorkflowNodeDto? match = FindKnownAgent(workflow, agentIdentifier)
            ?? ResolveSingleAgentAssistantAlias(workflow, agentIdentifier);
        if (match is null)
        {
            return false;
        }

        agent = ToAgentIdentity(match);
        return true;
    }

    public static bool TryResolveObservedAgentIdentity(
        WorkflowDefinitionDto workflow,
        string? agentIdentifier,
        AgentIdentity? fallbackAgent,
        out AgentIdentity agent)
    {
        if (TryResolveKnownAgentIdentity(workflow, agentIdentifier, out agent))
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
        WorkflowNodeDto? match = FindKnownAgent(workflow, agentId)
            ?? FindKnownAgent(workflow, agentName)
            ?? ResolveSingleAgentAssistantAlias(workflow, agentId, agentName);

        return match is not null
            ? ToAgentIdentity(match)
            : CreateFallbackIdentity(agentId, agentName);
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

    internal static bool IsGenericAssistantIdentifier(string? candidate)
    {
        return string.Equals(
            NormalizeComparisonKey(candidate),
            GenericAssistantIdentifier,
            StringComparison.Ordinal);
    }

    private static WorkflowNodeDto? ResolveSingleAgentAssistantAlias(
        WorkflowDefinitionDto workflow,
        params string?[] agentIdentifiers)
    {
        IReadOnlyList<WorkflowNodeDto> agentNodes = workflow.GetAgentNodes();
        return agentNodes.Count == 1 && agentIdentifiers.Any(IsGenericAssistantIdentifier)
            ? agentNodes[0]
            : null;
    }

    private static WorkflowNodeDto? FindKnownAgent(WorkflowDefinitionDto workflow, string? candidate)
    {
        return workflow.GetAgentNodes().FirstOrDefault(agent => MatchesAgent(agent, candidate));
    }

    private static AgentIdentity ToAgentIdentity(WorkflowNodeDto agent)
        => new(agent.GetAgentId(), agent.GetAgentName());

    private static AgentIdentity CreateFallbackIdentity(string? agentId, string? agentName)
    {
        string resolvedAgentId = !string.IsNullOrWhiteSpace(agentId)
            ? agentId
            : agentName ?? "agent";
        string resolvedAgentName = !string.IsNullOrWhiteSpace(agentName)
            ? agentName
            : resolvedAgentId;

        return new AgentIdentity(resolvedAgentId, resolvedAgentName);
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
