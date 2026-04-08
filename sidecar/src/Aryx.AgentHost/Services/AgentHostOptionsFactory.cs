using Microsoft.Agents.AI.Workflows;

namespace Aryx.AgentHost.Services;

internal static class AgentHostOptionsFactory
{
    public static AIAgentHostOptions CreateDefault()
    {
        return new AIAgentHostOptions
        {
            EmitAgentUpdateEvents = null,
            EmitAgentResponseEvents = false,
            InterceptUserInputRequests = false,
            InterceptUnterminatedFunctionCalls = false,
            ReassignOtherAgentsAsUsers = true,
            ForwardIncomingMessages = true,
        };
    }
}
