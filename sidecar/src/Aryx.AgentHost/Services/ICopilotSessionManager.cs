using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

public interface ICopilotSessionManager
{
    Task<IReadOnlyList<CopilotSessionInfoDto>> ListSessionsAsync(
        CopilotSessionListFilterDto? filter,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<CopilotSessionInfoDto>> DeleteSessionsAsync(
        string? aryxSessionId,
        string? copilotSessionId,
        CancellationToken cancellationToken);
}

