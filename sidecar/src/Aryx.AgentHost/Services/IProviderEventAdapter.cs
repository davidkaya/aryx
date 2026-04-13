using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal interface IProviderEventAdapter
{
    ProviderTurnStreamCapabilities Capabilities { get; }

    ProviderSessionEvent? TryAdapt(object rawEvent);
}
