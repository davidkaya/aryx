using Aryx.AgentHost.Services;
using OpenTelemetry.Exporter;
using OpenTelemetry.Trace;

namespace Aryx.AgentHost.Tests;

public sealed class OpenTelemetrySetupTests
{
    [Fact]
    public void ResolveTracingConfiguration_ReturnsNullWhenEndpointMissing()
    {
        OpenTelemetryTracingConfiguration? configuration = OpenTelemetrySetup.ResolveTracingConfiguration([]);

        Assert.Null(configuration);
    }

    [Fact]
    public void ResolveTracingConfiguration_UsesGrpcByDefault()
    {
        OpenTelemetryTracingConfiguration? configuration = OpenTelemetrySetup.ResolveTracingConfiguration(
        [
            new KeyValuePair<string, string?>("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
        ]);

        Assert.NotNull(configuration);
        Assert.Equal(new Uri("http://localhost:4317"), configuration.Endpoint);
        Assert.Equal(OtlpExportProtocol.Grpc, configuration.Protocol);
        Assert.Collection(
            configuration.ActivitySourceNames,
            source => Assert.Equal("Experimental.Microsoft.Agents.AI", source),
            source => Assert.Equal("Microsoft.Agents.AI.Workflows", source));
    }

    [Fact]
    public void ResolveTracingConfiguration_UsesHttpProtobufWhenRequested()
    {
        OpenTelemetryTracingConfiguration? configuration = OpenTelemetrySetup.ResolveTracingConfiguration(
        [
            new KeyValuePair<string, string?>("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318"),
            new KeyValuePair<string, string?>("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf"),
        ]);

        Assert.NotNull(configuration);
        Assert.Equal(new Uri("http://localhost:4318"), configuration.Endpoint);
        Assert.Equal(OtlpExportProtocol.HttpProtobuf, configuration.Protocol);
    }

    [Fact]
    public void ResolveTracingConfiguration_ThrowsWhenEndpointInvalid()
    {
        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() =>
            OpenTelemetrySetup.ResolveTracingConfiguration(
            [
                new KeyValuePair<string, string?>("OTEL_EXPORTER_OTLP_ENDPOINT", "localhost:4317"),
            ]));

        Assert.Contains("OTEL_EXPORTER_OTLP_ENDPOINT", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ResolveTracingConfiguration_ThrowsWhenProtocolUnsupported()
    {
        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() =>
            OpenTelemetrySetup.ResolveTracingConfiguration(
            [
                new KeyValuePair<string, string?>("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
                new KeyValuePair<string, string?>("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json"),
            ]));

        Assert.Contains("OTEL_EXPORTER_OTLP_PROTOCOL", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void CreateTracerProvider_CreatesProviderAndWritesDiagnosticsWhenConfigured()
    {
        StringWriter diagnosticsWriter = new();

        using TracerProvider? tracerProvider = OpenTelemetrySetup.CreateTracerProvider(
        [
            new KeyValuePair<string, string?>("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
        ],
        diagnosticsWriter);

        Assert.NotNull(tracerProvider);
        Assert.Contains("Aryx.AgentHost OpenTelemetry tracing enabled", diagnosticsWriter.ToString(), StringComparison.Ordinal);
    }
}
