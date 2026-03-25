using GitHub.Copilot.SDK;
using Eryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

internal sealed class SessionToolingBundle : IAsyncDisposable
{
    private const string LocalTransport = "local";
    private const string WildcardToolName = "*";

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
        (List<AIFunction> tools, List<IAsyncDisposable> disposables) =
            await BuildLspToolingAsync(tooling?.LspProfiles ?? [], projectPath, cancellationToken).ConfigureAwait(false);

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
            configurations[ResolveServerName(server)] = CreateServerConfiguration(server);
        }

        return configurations;
    }

    private static async Task<(List<AIFunction> Tools, List<IAsyncDisposable> Disposables)> BuildLspToolingAsync(
        IReadOnlyList<RunTurnLspProfileConfigDto> profiles,
        string projectPath,
        CancellationToken cancellationToken)
    {
        List<AIFunction> tools = [];
        List<IAsyncDisposable> disposables = [];

        foreach (RunTurnLspProfileConfigDto profile in profiles)
        {
            LspToolSession session = await LspToolSession.StartAsync(profile, projectPath, cancellationToken)
                .ConfigureAwait(false);
            disposables.Add(session);
            tools.AddRange(session.Tools);
        }

        return (tools, disposables);
    }

    private static object CreateServerConfiguration(RunTurnMcpServerConfigDto server)
    {
        return string.Equals(server.Transport, LocalTransport, StringComparison.OrdinalIgnoreCase)
            ? CreateLocalServerConfiguration(server)
            : CreateRemoteServerConfiguration(server);
    }

    private static McpLocalServerConfig CreateLocalServerConfiguration(RunTurnMcpServerConfigDto server)
    {
        string serverName = ResolveServerName(server);
        if (string.IsNullOrWhiteSpace(server.Command))
        {
            throw new InvalidOperationException($"MCP server \"{serverName}\" is missing a command.");
        }

        return new McpLocalServerConfig
        {
            Type = LocalTransport,
            Timeout = server.TimeoutMs,
            Command = server.Command,
            Args = server.Args?.ToList() ?? [],
            Env = server.Env is null ? null : new Dictionary<string, string>(server.Env, StringComparer.Ordinal),
            Cwd = string.IsNullOrWhiteSpace(server.Cwd) ? null : server.Cwd,
            Tools = ResolveTools(server),
        };
    }

    private static McpRemoteServerConfig CreateRemoteServerConfiguration(RunTurnMcpServerConfigDto server)
    {
        string serverName = ResolveServerName(server);
        if (string.IsNullOrWhiteSpace(server.Url))
        {
            throw new InvalidOperationException($"MCP server \"{serverName}\" is missing a URL.");
        }

        return new McpRemoteServerConfig
        {
            Type = server.Transport,
            Timeout = server.TimeoutMs,
            Url = server.Url,
            Headers = server.Headers is null ? null : new Dictionary<string, string>(server.Headers, StringComparer.Ordinal),
            Tools = ResolveTools(server),
        };
    }

    private static string ResolveServerName(RunTurnMcpServerConfigDto server)
    {
        return string.IsNullOrWhiteSpace(server.Name) ? server.Id : server.Name.Trim();
    }

    private static List<string> ResolveTools(RunTurnMcpServerConfigDto server)
    {
        return server.Tools.Count == 0 ? [WildcardToolName] : server.Tools.ToList();
    }
}
