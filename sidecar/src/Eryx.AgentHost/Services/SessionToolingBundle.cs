using GitHub.Copilot.SDK;
using Eryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

internal sealed class SessionToolingBundle : IAsyncDisposable
{
    private readonly List<IAsyncDisposable> _disposables = [];

    private SessionToolingBundle(
        Dictionary<string, object> mcpServers,
        IReadOnlyList<AIFunction> tools)
    {
        McpServers = mcpServers;
        Tools = tools;
    }

    public Dictionary<string, object> McpServers { get; }

    public IReadOnlyList<AIFunction> Tools { get; }

    public static async Task<SessionToolingBundle> CreateAsync(
        RunTurnToolingConfigDto? tooling,
        string projectPath,
        CancellationToken cancellationToken)
    {
        Dictionary<string, object> mcpServers = BuildMcpServerConfigurations(tooling?.McpServers ?? []);
        List<IAsyncDisposable> disposables = [];
        List<AIFunction> tools = [];

        foreach (RunTurnLspProfileConfigDto profile in tooling?.LspProfiles ?? [])
        {
            LspToolSession lspSession = await LspToolSession.StartAsync(profile, projectPath, cancellationToken)
                .ConfigureAwait(false);
            disposables.Add(lspSession);
            tools.AddRange(lspSession.Tools);
        }

        SessionToolingBundle bundle = new(mcpServers, tools);
        bundle._disposables.AddRange(disposables);
        return bundle;
    }

    public async ValueTask DisposeAsync()
    {
        foreach (IAsyncDisposable disposable in _disposables)
        {
            await disposable.DisposeAsync().ConfigureAwait(false);
        }
    }

    internal static Dictionary<string, object> BuildMcpServerConfigurations(
        IReadOnlyList<RunTurnMcpServerConfigDto> servers)
    {
        Dictionary<string, object> configurations = new(StringComparer.OrdinalIgnoreCase);

        foreach (RunTurnMcpServerConfigDto server in servers)
        {
            string serverName = string.IsNullOrWhiteSpace(server.Name) ? server.Id : server.Name.Trim();
            List<string> tools = server.Tools.Count == 0 ? ["*"] : server.Tools.ToList();

            if (string.Equals(server.Transport, "local", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrWhiteSpace(server.Command))
                {
                    throw new InvalidOperationException($"MCP server \"{serverName}\" is missing a command.");
                }

                configurations[serverName] = new McpLocalServerConfig
                {
                    Type = "local",
                    Timeout = server.TimeoutMs,
                    Command = server.Command,
                    Args = server.Args?.ToList() ?? [],
                    Cwd = string.IsNullOrWhiteSpace(server.Cwd) ? null : server.Cwd,
                    Tools = tools,
                };
                continue;
            }

            if (string.IsNullOrWhiteSpace(server.Url))
            {
                throw new InvalidOperationException($"MCP server \"{serverName}\" is missing a URL.");
            }

            configurations[serverName] = new McpRemoteServerConfig
            {
                Type = server.Transport,
                Timeout = server.TimeoutMs,
                Url = server.Url,
                Tools = tools,
            };
        }

        return configurations;
    }
}
