using Aryx.AgentHost.Services;

if (!args.Contains("--stdio", StringComparer.Ordinal))
{
    Console.Error.WriteLine("Aryx.AgentHost expects the --stdio flag.");
    return;
}

SidecarProtocolHost host = new();
await host.RunAsync(Console.In, Console.Out, CancellationToken.None);
