using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal interface IProviderEventAdapter
{
    ProviderSessionEvent? TryAdapt(object rawEvent);
}
