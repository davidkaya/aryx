using System.Text;
using Eryx.AgentHost.Contracts;

namespace Eryx.AgentHost.Services;

internal readonly record struct AgentIdentity(string AgentId, string AgentName);

internal static class AgentIdentityResolver
{
    public static bool TryResolveKnownAgentIdentity(
        PatternDefinitionDto pattern,
        string? agentIdentifier,
        out AgentIdentity agent)
    {
        agent = default;
        if (string.IsNullOrWhiteSpace(agentIdentifier))
        {
            return false;
        }

        PatternAgentDefinitionDto? match = FindKnownAgent(pattern, agentIdentifier);
        if (match is null
            && IsGenericAssistantIdentifier(agentIdentifier)
            && pattern.Agents.Count == 1)
        {
            match = pattern.Agents[0];
        }

        if (match is null)
        {
            return false;
        }

        agent = ToAgentIdentity(match);
        return true;
    }

    public static bool TryResolveObservedAgentIdentity(
        PatternDefinitionDto pattern,
        string? agentIdentifier,
        AgentIdentity? fallbackAgent,
        out AgentIdentity agent)
    {
        if (TryResolveKnownAgentIdentity(pattern, agentIdentifier, out agent))
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
        PatternDefinitionDto pattern,
        string? agentId,
        string? agentName)
    {
        PatternAgentDefinitionDto? match = FindKnownAgent(pattern, agentId)
            ?? FindKnownAgent(pattern, agentName);

        if (match is null
            && pattern.Agents.Count == 1
            && (IsGenericAssistantIdentifier(agentId) || IsGenericAssistantIdentifier(agentName)))
        {
            match = pattern.Agents[0];
        }

        if (match is not null)
        {
            return ToAgentIdentity(match);
        }

        string resolvedAgentId = !string.IsNullOrWhiteSpace(agentId)
            ? agentId
            : agentName ?? "agent";

        if (!string.IsNullOrWhiteSpace(agentName))
        {
            return new AgentIdentity(resolvedAgentId, agentName);
        }

        return new AgentIdentity(resolvedAgentId, resolvedAgentId);
    }

    public static string ResolveDisplayAuthorName(
        PatternDefinitionDto pattern,
        string? primaryIdentifier,
        string? fallbackIdentifier = null)
    {
        if (TryResolveKnownAgentIdentity(pattern, primaryIdentifier, out AgentIdentity primaryAgent))
        {
            return primaryAgent.AgentName;
        }

        if (TryResolveKnownAgentIdentity(pattern, fallbackIdentifier, out AgentIdentity fallbackAgent))
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

        return "assistant";
    }

    private static PatternAgentDefinitionDto? FindKnownAgent(PatternDefinitionDto pattern, string? candidate)
    {
        return pattern.Agents.FirstOrDefault(agent => MatchesAgent(agent, candidate));
    }

    private static AgentIdentity ToAgentIdentity(PatternAgentDefinitionDto agent)
    {
        return new AgentIdentity(
            agent.Id,
            string.IsNullOrWhiteSpace(agent.Name) ? agent.Id : agent.Name);
    }

    private static bool MatchesAgent(PatternAgentDefinitionDto agent, string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return false;
        }

        if (string.Equals(agent.Id, candidate, StringComparison.OrdinalIgnoreCase)
            || string.Equals(agent.Name, candidate, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        string normalizedCandidate = NormalizeComparisonKey(candidate);
        string normalizedId = NormalizeComparisonKey(agent.Id);
        string normalizedName = NormalizeComparisonKey(agent.Name);

        if (normalizedCandidate.Length == 0)
        {
            return false;
        }

        if (normalizedCandidate == normalizedId
            || normalizedCandidate == normalizedName)
        {
            return true;
        }

        if (normalizedId.Length > 0
            && normalizedCandidate.EndsWith(normalizedId, StringComparison.Ordinal))
        {
            return true;
        }

        return normalizedId.Length > 0
            && normalizedName.Length > 0
            && normalizedCandidate.Contains(normalizedId, StringComparison.Ordinal)
            && normalizedCandidate.Contains(normalizedName, StringComparison.Ordinal);
    }

    internal static bool IsGenericAssistantIdentifier(string? candidate)
    {
        return string.Equals(
            NormalizeComparisonKey(candidate),
            "assistant",
            StringComparison.Ordinal);
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
