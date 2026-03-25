using System.Text.Json;
using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

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

    [Fact]
    public void ResolveProcessArguments_AddsStdioForTypeScriptLanguageServer()
    {
        RunTurnLspProfileConfigDto profile = new()
        {
            Command = "typescript-language-server",
            Args = [],
        };

        IReadOnlyList<string> args = LspToolSession.ResolveProcessArguments(profile);

        Assert.Equal(["--stdio"], args);
    }

    [Fact]
    public void ResolveProcessArguments_DoesNotDuplicateStdioWhenAlreadyPresent()
    {
        RunTurnLspProfileConfigDto profile = new()
        {
            Command = "typescript-language-server",
            Args = ["--stdio"],
        };

        IReadOnlyList<string> args = LspToolSession.ResolveProcessArguments(profile);

        Assert.Equal(["--stdio"], args);
    }
}
