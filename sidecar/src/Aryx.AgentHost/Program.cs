using Aryx.AgentHost.Services;
using OpenTelemetry.Trace;

if (!args.Contains("--stdio", StringComparer.Ordinal))
{
    Console.Error.WriteLine("Aryx.AgentHost expects the --stdio flag.");
    return;
}

using TracerProvider? tracerProvider = OpenTelemetrySetup.CreateTracerProviderFromEnvironment();

SidecarProtocolHost host = new();
await host.RunAsync(Console.In, Console.Out, CancellationToken.None);
