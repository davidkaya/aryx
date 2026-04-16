using System.Collections;
using OpenTelemetry;
using OpenTelemetry.Exporter;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

namespace Aryx.AgentHost.Services;

internal static class OpenTelemetrySetup
{
    private const string ServiceName = "Aryx.AgentHost";
    private const string EndpointEnvironmentVariableName = "OTEL_EXPORTER_OTLP_ENDPOINT";
    private const string ProtocolEnvironmentVariableName = "OTEL_EXPORTER_OTLP_PROTOCOL";

    private static readonly string[] ActivitySourceNames =
    [
        "Experimental.Microsoft.Agents.AI",
        "Microsoft.Agents.AI.Workflows",
    ];

    public static TracerProvider? CreateTracerProviderFromEnvironment(TextWriter? diagnosticsWriter = null)
    {
        return CreateTracerProvider(ReadEnvironmentVariables(), diagnosticsWriter ?? Console.Error);
    }

    internal static TracerProvider? CreateTracerProvider(
        IEnumerable<KeyValuePair<string, string?>> environmentVariables,
        TextWriter diagnosticsWriter)
    {
        ArgumentNullException.ThrowIfNull(environmentVariables);
        ArgumentNullException.ThrowIfNull(diagnosticsWriter);

        OpenTelemetryTracingConfiguration? configuration = ResolveTracingConfiguration(environmentVariables);
        if (configuration is null)
        {
            return null;
        }

        diagnosticsWriter.WriteLine(
            $"Aryx.AgentHost OpenTelemetry tracing enabled ({configuration.ProtocolLabel}) -> {configuration.Endpoint}.");

        return Sdk.CreateTracerProviderBuilder()
            .SetResourceBuilder(
                ResourceBuilder.CreateDefault()
                    .AddService(ServiceName, serviceVersion: ResolveServiceVersion()))
            .AddSource(configuration.ActivitySourceNames.ToArray())
            .AddOtlpExporter(options =>
            {
                options.Endpoint = configuration.Endpoint;
                options.Protocol = configuration.Protocol;
            })
            .Build();
    }

    internal static OpenTelemetryTracingConfiguration? ResolveTracingConfiguration(
        IEnumerable<KeyValuePair<string, string?>> environmentVariables)
    {
        ArgumentNullException.ThrowIfNull(environmentVariables);

        string? endpointValue = ReadSetting(environmentVariables, EndpointEnvironmentVariableName);
        if (string.IsNullOrWhiteSpace(endpointValue))
        {
            return null;
        }

        if (!Uri.TryCreate(endpointValue, UriKind.Absolute, out Uri? endpoint)
            || (endpoint.Scheme != Uri.UriSchemeHttp && endpoint.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException(
                $"{EndpointEnvironmentVariableName} must be an absolute http or https URL. Received '{endpointValue}'.");
        }

        OtlpExportProtocol protocol = ResolveProtocol(ReadSetting(environmentVariables, ProtocolEnvironmentVariableName));
        return new OpenTelemetryTracingConfiguration(endpoint, protocol, ActivitySourceNames);
    }

    private static string? ResolveServiceVersion()
    {
        return typeof(OpenTelemetrySetup).Assembly.GetName().Version?.ToString();
    }

    private static IEnumerable<KeyValuePair<string, string?>> ReadEnvironmentVariables()
    {
        return Environment.GetEnvironmentVariables()
            .Cast<DictionaryEntry>()
            .Select(entry => new KeyValuePair<string, string?>(
                entry.Key?.ToString() ?? string.Empty,
                entry.Value?.ToString()));
    }

    private static string? ReadSetting(
        IEnumerable<KeyValuePair<string, string?>> environmentVariables,
        string name)
    {
        foreach (KeyValuePair<string, string?> entry in environmentVariables)
        {
            if (!string.Equals(entry.Key, name, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return string.IsNullOrWhiteSpace(entry.Value)
                ? null
                : entry.Value.Trim();
        }

        return null;
    }

    private static OtlpExportProtocol ResolveProtocol(string? protocolValue)
    {
        if (string.IsNullOrWhiteSpace(protocolValue))
        {
            return OtlpExportProtocol.Grpc;
        }

        return protocolValue.Trim().ToLowerInvariant() switch
        {
            "grpc" => OtlpExportProtocol.Grpc,
            "http/protobuf" => OtlpExportProtocol.HttpProtobuf,
            _ => throw new InvalidOperationException(
                $"{ProtocolEnvironmentVariableName} must be 'grpc' or 'http/protobuf'. Received '{protocolValue}'."),
        };
    }
}

internal sealed record OpenTelemetryTracingConfiguration(
    Uri Endpoint,
    OtlpExportProtocol Protocol,
    IReadOnlyList<string> ActivitySourceNames)
{
    public string ProtocolLabel => Protocol switch
    {
        OtlpExportProtocol.HttpProtobuf => "http/protobuf",
        _ => "grpc",
    };
}
