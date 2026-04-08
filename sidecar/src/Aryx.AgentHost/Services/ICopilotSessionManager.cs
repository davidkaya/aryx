using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

public interface IProviderSessionManager
{
    Task<IReadOnlyList<CopilotSessionInfoDto>> ListSessionsAsync(
        CopilotSessionListFilterDto? filter,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<CopilotSessionInfoDto>> DeleteSessionsAsync(
        string? aryxSessionId,
        string? copilotSessionId,
        CancellationToken cancellationToken);

    Task<IReadOnlyDictionary<string, QuotaSnapshotDto>> GetQuotaAsync(
        CancellationToken cancellationToken);
}

public interface ICopilotSessionManager : IProviderSessionManager;

