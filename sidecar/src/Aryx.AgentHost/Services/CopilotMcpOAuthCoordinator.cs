using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotMcpOAuthCoordinator
{
    public McpOauthRequiredEventDto BuildMcpOauthRequiredEvent(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        McpOauthRequiredEvent request)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(agent);
        ArgumentNullException.ThrowIfNull(request);

        McpOauthRequiredData requestData = request.Data
            ?? throw new InvalidOperationException("MCP OAuth request data is required.");

        string oauthRequestId = NormalizeOptionalString(requestData.RequestId)
            ?? throw new InvalidOperationException("MCP OAuth request ID is required.");
        string? normalizedAgentId = NormalizeOptionalString(agent.Id);
        string? normalizedAgentName = NormalizeOptionalString(agent.Name) ?? normalizedAgentId;

        return new McpOauthRequiredEventDto
        {
            Type = "mcp-oauth-required",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            OauthRequestId = oauthRequestId,
            AgentId = normalizedAgentId,
            AgentName = normalizedAgentName,
            ServerName = NormalizeOptionalString(requestData.ServerName) ?? string.Empty,
            ServerUrl = NormalizeOptionalString(requestData.ServerUrl) ?? string.Empty,
            StaticClientConfig = BuildStaticClientConfig(requestData.StaticClientConfig),
        };
    }

    private static McpOauthStaticClientConfigDto? BuildStaticClientConfig(
        McpOauthRequiredDataStaticClientConfig? staticClientConfig)
    {
        if (staticClientConfig is null)
        {
            return null;
        }

        return new McpOauthStaticClientConfigDto
        {
            ClientId = NormalizeOptionalString(staticClientConfig.ClientId) ?? string.Empty,
            PublicClient = staticClientConfig.PublicClient,
        };
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
