using System.Text.Json;
using Eryx.AgentHost.Services;

namespace Eryx.AgentHost.Tests;

public sealed class LspToolSessionTests
{
    [Fact]
    public void CreateJsonSerializerOptions_ReturnsReadOnlyResolverBackedOptions()
    {
        JsonSerializerOptions options = LspToolSession.CreateJsonSerializerOptions();

        Assert.True(options.IsReadOnly);
        Assert.NotNull(options.TypeInfoResolver);

        string json = JsonSerializer.Serialize(
            new
            {
                RelativePath = "src/file.ts",
                Line = 12,
                Character = 4,
            },
            options);

        Assert.Contains("relativePath", json);
    }
}
