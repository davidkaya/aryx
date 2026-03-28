namespace Aryx.AgentHost.Services;

internal static class CopilotManagedSessionIds
{
    private const string Prefix = "aryx::";
    private const string Separator = "::";

    public static string Build(string aryxSessionId, string agentId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(aryxSessionId);
        ArgumentException.ThrowIfNullOrWhiteSpace(agentId);

        return $"{Prefix}{Uri.EscapeDataString(aryxSessionId)}{Separator}{Uri.EscapeDataString(agentId)}";
    }

    public static bool IsManagedByAryx(string copilotSessionId)
        => TryParse(copilotSessionId, out _, out _);

    public static bool IsManagedByAryx(string copilotSessionId, string aryxSessionId)
    {
        return TryParse(copilotSessionId, out string? parsedSessionId, out _)
            && string.Equals(parsedSessionId, aryxSessionId, StringComparison.Ordinal);
    }

    public static bool TryParse(string? copilotSessionId, out string aryxSessionId, out string agentId)
    {
        aryxSessionId = string.Empty;
        agentId = string.Empty;

        if (string.IsNullOrWhiteSpace(copilotSessionId)
            || !copilotSessionId.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return false;
        }

        string payload = copilotSessionId[Prefix.Length..];
        string[] parts = payload.Split(Separator, StringSplitOptions.None);
        if (parts.Length != 2
            || string.IsNullOrWhiteSpace(parts[0])
            || string.IsNullOrWhiteSpace(parts[1]))
        {
            return false;
        }

        aryxSessionId = Uri.UnescapeDataString(parts[0]);
        agentId = Uri.UnescapeDataString(parts[1]);
        return true;
    }
}

