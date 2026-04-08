using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal interface IAgentProvider
{
    ITurnWorkflowRunner CreateWorkflowRunner(WorkflowValidator workflowValidator);

    Task<SidecarCapabilitiesDto> GetCapabilitiesAsync(CancellationToken cancellationToken);

    IProviderSessionManager CreateSessionManager();
}
