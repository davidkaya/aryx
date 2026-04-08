using Microsoft.Agents.AI;

namespace Aryx.AgentHost.Services;

internal abstract class ProviderAgentBundle : IAsyncDisposable
{
    public abstract IReadOnlyList<AIAgent> Agents { get; }

    public abstract bool HasConfiguredHooks { get; }

    public abstract IProviderTranscriptProjector TranscriptProjector { get; }

    public abstract ValueTask DisposeAsync();
}
