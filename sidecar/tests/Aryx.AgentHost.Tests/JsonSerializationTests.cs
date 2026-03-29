using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class JsonSerializationTests
{
    [Fact]
    public void CreateWebOptions_UsesDefaultJsonTypeInfoResolver()
    {
        JsonSerializerOptions options = JsonSerialization.CreateWebOptions();

        Assert.IsType<DefaultJsonTypeInfoResolver>(options.TypeInfoResolver);
    }

    [Fact]
    public void CreateWebOptions_RoundTripsRuntimeTypedPayloads()
    {
        JsonSerializerOptions options = JsonSerialization.CreateWebOptions();
        object payload = new TestPayload
        {
            Type = "describe-capabilities",
            RequestId = "req-1",
        };

        string json = JsonSerializer.Serialize(payload, payload.GetType(), options);
        TestPayload? deserialized = JsonSerializer.Deserialize<TestPayload>(json, options);

        Assert.NotNull(deserialized);
        Assert.Equal("describe-capabilities", deserialized.Type);
        Assert.Equal("req-1", deserialized.RequestId);
    }

    private sealed class TestPayload
    {
        public string? Type { get; init; }

        public string? RequestId { get; init; }
    }
}
