using System.Text.Json;
using Kopaya.AgentHost.Contracts;
using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

public sealed class SidecarProtocolHostTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    [Fact]
    public async Task DescribeCapabilitiesCommand_ReturnsCapabilitiesAndCompletion()
    {
        IReadOnlyList<JsonElement> events = await RunHostAsync(new DescribeCapabilitiesCommandDto
        {
            Type = "describe-capabilities",
            RequestId = "cap-1",
        });

        Assert.Collection(
            events,
            capabilitiesEvent =>
            {
                Assert.Equal("capabilities", capabilitiesEvent.GetProperty("type").GetString());
                Assert.Equal("cap-1", capabilitiesEvent.GetProperty("requestId").GetString());

                JsonElement capabilities = capabilitiesEvent.GetProperty("capabilities");
                Assert.Equal("dotnet-maf", capabilities.GetProperty("runtime").GetString());

                JsonElement modes = capabilities.GetProperty("modes");
                Assert.True(modes.GetProperty("single").GetProperty("available").GetBoolean());
                Assert.False(modes.GetProperty("magentic").GetProperty("available").GetBoolean());

                string magenticReason = modes.GetProperty("magentic").GetProperty("reason").GetString() ?? string.Empty;
                Assert.Contains("unsupported", magenticReason, StringComparison.OrdinalIgnoreCase);
            },
            completionEvent =>
            {
                Assert.Equal("command-complete", completionEvent.GetProperty("type").GetString());
                Assert.Equal("cap-1", completionEvent.GetProperty("requestId").GetString());
            });
    }

    [Fact]
    public async Task ValidatePatternCommand_ReturnsIssuesAndCompletion()
    {
        IReadOnlyList<JsonElement> events = await RunHostAsync(new ValidatePatternCommandDto
        {
            Type = "validate-pattern",
            RequestId = "validate-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "single-pattern",
                Name = "",
                Mode = "single",
                Availability = "available",
                Agents =
                [
                    CreateAgent(),
                    CreateAgent(id: "agent-2", name: "Reviewer", model: ""),
                ],
            },
        });

        Assert.Collection(
            events,
            validationEvent =>
            {
                Assert.Equal("pattern-validation", validationEvent.GetProperty("type").GetString());
                Assert.Equal("validate-1", validationEvent.GetProperty("requestId").GetString());

                JsonElement[] issues = validationEvent.GetProperty("issues").EnumerateArray().ToArray();
                Assert.Contains(issues, issue =>
                    issue.GetProperty("field").GetString() == "name"
                    && issue.GetProperty("message").GetString() == "Pattern name is required.");
                Assert.Contains(issues, issue =>
                    issue.GetProperty("field").GetString() == "agents"
                    && issue.GetProperty("message").GetString() == "Single-agent chat requires exactly one agent.");
                Assert.Contains(issues, issue =>
                    issue.GetProperty("field").GetString() == "agents.model"
                    && issue.GetProperty("message").GetString() == "Agent \"Reviewer\" requires a model identifier.");
            },
            completionEvent =>
            {
                Assert.Equal("command-complete", completionEvent.GetProperty("type").GetString());
                Assert.Equal("validate-1", completionEvent.GetProperty("requestId").GetString());
            });
    }

    private static async Task<IReadOnlyList<JsonElement>> RunHostAsync<TCommand>(TCommand command)
    {
        string input = JsonSerializer.Serialize(command, JsonOptions) + Environment.NewLine;

        using StringReader reader = new(input);
        using StringWriter writer = new();

        SidecarProtocolHost host = new();
        await host.RunAsync(reader, writer, CancellationToken.None);

        return ParseEvents(writer.ToString());
    }

    private static IReadOnlyList<JsonElement> ParseEvents(string output)
    {
        List<JsonElement> events = [];
        using StringReader reader = new(output);

        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            using JsonDocument document = JsonDocument.Parse(line);
            events.Add(document.RootElement.Clone());
        }

        return events;
    }

    private static PatternAgentDefinitionDto CreateAgent(
        string id = "agent-1",
        string name = "Primary",
        string model = "gpt-5.4",
        string instructions = "Help with the user's request.")
    {
        return new PatternAgentDefinitionDto
        {
            Id = id,
            Name = name,
            Model = model,
            Instructions = instructions,
        };
    }
}
