using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using GitHub.Copilot.SDK.Rpc;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotSessionManager : ICopilotSessionManager
{
    public async Task<IReadOnlyDictionary<string, QuotaSnapshotDto>> GetQuotaAsync(
        CancellationToken cancellationToken)
    {
        await using CopilotClient client = await CreateStartedClientAsync(cancellationToken).ConfigureAwait(false);
        AccountGetQuotaResult result = await client.Rpc.Account.GetQuotaAsync(cancellationToken).ConfigureAwait(false);
        return QuotaSnapshotMapper.Map(result.QuotaSnapshots);
    }

    public async Task<IReadOnlyList<CopilotSessionInfoDto>> ListSessionsAsync(
        CopilotSessionListFilterDto? filter,
        CancellationToken cancellationToken)
    {
        await using CopilotClient client = await CreateStartedClientAsync(cancellationToken).ConfigureAwait(false);
        List<SessionMetadata> sessions = await client.ListSessionsAsync(CreateFilter(filter), cancellationToken)
            .ConfigureAwait(false);

        return sessions
            .Select(MapSession)
            .OrderByDescending(session => session.ModifiedTime, StringComparer.Ordinal)
            .ToList();
    }

    public async Task<IReadOnlyList<CopilotSessionInfoDto>> DeleteSessionsAsync(
        string? aryxSessionId,
        string? copilotSessionId,
        CancellationToken cancellationToken)
    {
        string? normalizedAryxSessionId = Normalize(aryxSessionId);
        string? normalizedCopilotSessionId = Normalize(copilotSessionId);
        if (normalizedAryxSessionId is null && normalizedCopilotSessionId is null)
        {
            throw new InvalidOperationException("delete-session requires a sessionId or copilotSessionId.");
        }

        await using CopilotClient client = await CreateStartedClientAsync(cancellationToken).ConfigureAwait(false);
        List<SessionMetadata> sessions = await client.ListSessionsAsync(null, cancellationToken).ConfigureAwait(false);
        List<CopilotSessionInfoDto> targets = sessions
            .Select(MapSession)
            .Where(session =>
                (normalizedCopilotSessionId is not null
                    && string.Equals(session.CopilotSessionId, normalizedCopilotSessionId, StringComparison.Ordinal))
                || (normalizedAryxSessionId is not null
                    && string.Equals(session.SessionId, normalizedAryxSessionId, StringComparison.Ordinal)
                    && session.ManagedByAryx))
            .ToList();

        if (targets.Count == 0 && normalizedCopilotSessionId is not null)
        {
            targets.Add(CreateUnknownSessionInfo(normalizedCopilotSessionId));
        }

        foreach (CopilotSessionInfoDto target in targets)
        {
            await client.DeleteSessionAsync(target.CopilotSessionId, cancellationToken).ConfigureAwait(false);
        }

        return targets;
    }

    private static async Task<CopilotClient> CreateStartedClientAsync(CancellationToken cancellationToken)
    {
        CopilotClient client = new(CopilotCliPathResolver.CreateClientOptions());
        await client.StartAsync(cancellationToken).ConfigureAwait(false);
        return client;
    }

    private static SessionListFilter? CreateFilter(CopilotSessionListFilterDto? filter)
    {
        if (filter is null)
        {
            return null;
        }

        return new SessionListFilter
        {
            Cwd = Normalize(filter.Cwd),
            GitRoot = Normalize(filter.GitRoot),
            Repository = Normalize(filter.Repository),
            Branch = Normalize(filter.Branch),
        };
    }

    private static CopilotSessionInfoDto MapSession(SessionMetadata session)
    {
        bool managedByAryx = CopilotManagedSessionIds.TryParse(
            session.SessionId,
            out string aryxSessionId,
            out string agentId);

        return new CopilotSessionInfoDto
        {
            CopilotSessionId = session.SessionId,
            ManagedByAryx = managedByAryx,
            SessionId = managedByAryx ? aryxSessionId : null,
            AgentId = managedByAryx ? agentId : null,
            StartTime = session.StartTime.ToUniversalTime().ToString("O"),
            ModifiedTime = session.ModifiedTime.ToUniversalTime().ToString("O"),
            Summary = Normalize(session.Summary),
            IsRemote = session.IsRemote,
            Cwd = Normalize(session.Context?.Cwd),
            GitRoot = Normalize(session.Context?.GitRoot),
            Repository = Normalize(session.Context?.Repository),
            Branch = Normalize(session.Context?.Branch),
        };
    }

    private static CopilotSessionInfoDto CreateUnknownSessionInfo(string copilotSessionId)
    {
        bool managedByAryx = CopilotManagedSessionIds.TryParse(
            copilotSessionId,
            out string aryxSessionId,
            out string agentId);

        return new CopilotSessionInfoDto
        {
            CopilotSessionId = copilotSessionId,
            ManagedByAryx = managedByAryx,
            SessionId = managedByAryx ? aryxSessionId : null,
            AgentId = managedByAryx ? agentId : null,
        };
    }

    private static string? Normalize(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

