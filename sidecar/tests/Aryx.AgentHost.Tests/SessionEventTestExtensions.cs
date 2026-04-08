using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

internal static class SessionEventTestExtensions
{
    private static readonly IProviderEventAdapter ProviderEventAdapter = new CopilotEventAdapter();

    public static void ObserveSessionEvent(
        this CopilotTurnExecutionState state,
        WorkflowNodeDto agentDefinition,
        SessionEvent sessionEvent)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(agentDefinition);
        ArgumentNullException.ThrowIfNull(sessionEvent);

        ProviderSessionEvent providerEvent = Assert.IsAssignableFrom<ProviderSessionEvent>(
            ProviderEventAdapter.TryAdapt(sessionEvent));

        state.ObserveSessionEvent(agentDefinition, providerEvent);
    }
}
