using System.Text;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal readonly record struct AgentIdentity(string AgentId, string AgentName);

internal static class AgentIdentityResolver
{
    private const string GenericAssistantIdentifier = "assistant";

    public static bool TryResolveKnownAgentIdentity(
        PatternDefinitionDto pattern,
        string? agentIdentifier,
        out AgentIdentity agent)
    {
        agent = default;

        PatternAgentDefinitionDto? match = FindKnownAgent(pattern, agentIdentifier)
            ?? ResolveSingleAgentAssistantAlias(pattern, agentIdentifier);
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
            ?? FindKnownAgent(pattern, agentName)
            ?? ResolveSingleAgentAssistantAlias(pattern, agentId, agentName);

        return match is not null
            ? ToAgentIdentity(match)
            : CreateFallbackIdentity(agentId, agentName);
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

        return GenericAssistantIdentifier;
    }

    internal static bool IsGenericAssistantIdentifier(string? candidate)
    {
        return string.Equals(
            NormalizeComparisonKey(candidate),
            GenericAssistantIdentifier,
            StringComparison.Ordinal);
    }

    private static PatternAgentDefinitionDto? ResolveSingleAgentAssistantAlias(
        PatternDefinitionDto pattern,
        params string?[] agentIdentifiers)
    {
        return pattern.Agents.Count == 1 && agentIdentifiers.Any(IsGenericAssistantIdentifier)
            ? pattern.Agents[0]
            : null;
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
