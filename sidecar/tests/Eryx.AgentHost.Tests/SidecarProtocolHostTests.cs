using System.Text.Json;
using Eryx.AgentHost.Contracts;
using Eryx.AgentHost.Services;

namespace Eryx.AgentHost.Tests;

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
        }, CreateHostForTests());

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
                JsonElement[] models = capabilities.GetProperty("models").EnumerateArray().ToArray();
                JsonElement model = Assert.Single(models);
                Assert.Equal("gpt-5.4", model.GetProperty("id").GetString());
                Assert.Equal("medium", model.GetProperty("defaultReasoningEffort").GetString());
                JsonElement connection = capabilities.GetProperty("connection");
                Assert.Equal("ready", connection.GetProperty("status").GetString());
                Assert.Equal(@"C:\tools\copilot\copilot.exe", connection.GetProperty("copilotCliPath").GetString());
                JsonElement cliVersion = connection.GetProperty("copilotCliVersion");
                Assert.Equal("latest", cliVersion.GetProperty("status").GetString());
                Assert.Equal("1.0.10", cliVersion.GetProperty("installedVersion").GetString());
                JsonElement account = connection.GetProperty("account");
                Assert.True(account.GetProperty("authenticated").GetBoolean());
                Assert.Equal("octocat", account.GetProperty("login").GetString());

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

    [Fact]
    public async Task RunTurnCommand_ReturnsActivityEventsAndCompletion()
    {
        SidecarProtocolHost host = new(
            new PatternValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, cancellationToken) =>
            {
                await onActivity(new AgentActivityEventDto
                {
                    Type = "agent-activity",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    ActivityType = "thinking",
                    AgentId = "agent-1",
                    AgentName = "Primary",
                });

                await onDelta(new TurnDeltaEventDto
                {
                    Type = "turn-delta",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    MessageId = "assistant-1",
                    AuthorName = "Primary",
                    ContentDelta = "Hello",
                });

                await onActivity(new AgentActivityEventDto
                {
                    Type = "agent-activity",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    ActivityType = "tool-calling",
                    AgentId = "agent-1",
                    AgentName = "Primary",
                    ToolName = "read_file",
                });

                return
                [
                    new ChatMessageDto
                    {
                        Id = "assistant-1",
                        Role = "assistant",
                        AuthorName = "Primary",
                        Content = "Hello world",
                        CreatedAt = "2026-01-01T00:00:00.0000000Z",
                    },
                ];
            }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            new RunTurnCommandDto
            {
                Type = "run-turn",
                RequestId = "turn-1",
                SessionId = "session-1",
                ProjectPath = "C:\\workspace\\project",
                Pattern = new PatternDefinitionDto
                {
                    Id = "pattern-1",
                    Name = "Single Agent",
                    Mode = "single",
                    Availability = "available",
                    Agents =
                    [
                        CreateAgent(name: "Primary"),
                    ],
                },
                Messages =
                [
                    new ChatMessageDto
                    {
                        Id = "user-1",
                        Role = "user",
                        AuthorName = "You",
                        Content = "Hello",
                        CreatedAt = "2026-01-01T00:00:00.0000000Z",
                    },
                ],
            },
            host);

        Assert.Collection(
            events,
            thinkingEvent =>
            {
                Assert.Equal("agent-activity", thinkingEvent.GetProperty("type").GetString());
                Assert.Equal("turn-1", thinkingEvent.GetProperty("requestId").GetString());
                Assert.Equal("session-1", thinkingEvent.GetProperty("sessionId").GetString());
                Assert.Equal("thinking", thinkingEvent.GetProperty("activityType").GetString());
                Assert.Equal("agent-1", thinkingEvent.GetProperty("agentId").GetString());
                Assert.Equal("Primary", thinkingEvent.GetProperty("agentName").GetString());
            },
            deltaEvent =>
            {
                Assert.Equal("turn-delta", deltaEvent.GetProperty("type").GetString());
                Assert.Equal("Hello", deltaEvent.GetProperty("contentDelta").GetString());
            },
            toolEvent =>
            {
                Assert.Equal("agent-activity", toolEvent.GetProperty("type").GetString());
                Assert.Equal("tool-calling", toolEvent.GetProperty("activityType").GetString());
                Assert.Equal("agent-1", toolEvent.GetProperty("agentId").GetString());
                Assert.Equal("read_file", toolEvent.GetProperty("toolName").GetString());
            },
            completionEvent =>
            {
                Assert.Equal("turn-complete", completionEvent.GetProperty("type").GetString());
                Assert.Equal("session-1", completionEvent.GetProperty("sessionId").GetString());
                JsonElement[] messages = completionEvent.GetProperty("messages").EnumerateArray().ToArray();
                Assert.Single(messages);
                Assert.Equal("Hello world", messages[0].GetProperty("content").GetString());
            },
            commandCompleteEvent =>
            {
                Assert.Equal("command-complete", commandCompleteEvent.GetProperty("type").GetString());
                Assert.Equal("turn-1", commandCompleteEvent.GetProperty("requestId").GetString());
            });
    }

    [Fact]
    public void ClassifyConnectionStatus_ReturnsAuthRequiredForLoginFailures()
    {
        string status = SidecarProtocolHost.ClassifyConnectionStatus(
            new InvalidOperationException("Please run copilot auth login to continue."));

        Assert.Equal("copilot-auth-required", status);
    }

    [Fact]
    public void CreateReadyConnectionDiagnostics_ReportsCliPathAndModelCount()
    {
        SidecarConnectionDiagnosticsDto diagnostics =
            SidecarProtocolHost.CreateReadyConnectionDiagnostics(
                @"C:\tools\copilot\copilot.exe",
                2,
                new SidecarCopilotCliVersionDiagnosticsDto
                {
                    Status = "outdated",
                    InstalledVersion = "1.0.9",
                    LatestVersion = "1.0.10",
                },
                new SidecarCopilotAccountDiagnosticsDto
                {
                    Authenticated = true,
                    Login = "octocat",
                    Host = "github.com",
                    Organizations = ["github"],
                });

        Assert.Equal("ready", diagnostics.Status);
        Assert.Equal(@"C:\tools\copilot\copilot.exe", diagnostics.CopilotCliPath);
        Assert.Contains("2 models", diagnostics.Summary, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("outdated", diagnostics.CopilotCliVersion?.Status);
        Assert.Equal("octocat", diagnostics.Account?.Login);
        Assert.Equal(["github"], diagnostics.Account?.Organizations);
        Assert.False(string.IsNullOrWhiteSpace(diagnostics.CheckedAt));
    }

    private static async Task<IReadOnlyList<JsonElement>> RunHostAsync(
        object command,
        SidecarProtocolHost? host = null)
    {
        string input = JsonSerializer.Serialize(command, JsonOptions) + Environment.NewLine;

        using StringReader reader = new(input);
        using StringWriter writer = new();

        await (host ?? CreateHostForTests()).RunAsync(reader, writer, CancellationToken.None);
        return ParseEvents(writer.ToString());
    }

    private static SidecarProtocolHost CreateHostForTests()
    {
        return new SidecarProtocolHost(
            new PatternValidator(),
            capabilitiesProvider: _ => Task.FromResult(new SidecarCapabilitiesDto
            {
                Modes = new Dictionary<string, SidecarModeCapabilityDto>(StringComparer.OrdinalIgnoreCase)
                {
                    ["single"] = new() { Available = true },
                    ["sequential"] = new() { Available = true },
                    ["concurrent"] = new() { Available = true },
                    ["handoff"] = new() { Available = true },
                    ["group-chat"] = new() { Available = true },
                    ["magentic"] = new()
                    {
                        Available = false,
                        Reason = "Microsoft Agent Framework currently documents Magentic orchestration as unsupported in C#.",
                    },
                },
                Models =
                [
                    new SidecarModelCapabilityDto
                    {
                        Id = "gpt-5.4",
                        Name = "GPT-5.4",
                        SupportedReasoningEfforts = ["low", "medium", "high", "xhigh"],
                        DefaultReasoningEffort = "medium",
                    },
                ],
                Connection = new SidecarConnectionDiagnosticsDto
                {
                    Status = "ready",
                    Summary = "Connected to GitHub Copilot. 1 model is available.",
                    CopilotCliPath = @"C:\tools\copilot\copilot.exe",
                    CopilotCliVersion = new SidecarCopilotCliVersionDiagnosticsDto
                    {
                        Status = "latest",
                        InstalledVersion = "1.0.10",
                        LatestVersion = "1.0.10",
                    },
                    Account = new SidecarCopilotAccountDiagnosticsDto
                    {
                        Authenticated = true,
                        Login = "octocat",
                        Host = "github.com",
                        Organizations = ["github", "mona"],
                    },
                    CheckedAt = "2026-01-01T00:00:00.0000000Z",
                },
            }));
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

    private sealed class FakeWorkflowRunner : ITurnWorkflowRunner
    {
        private readonly Func<
            RunTurnCommandDto,
            Func<TurnDeltaEventDto, Task>,
            Func<AgentActivityEventDto, Task>,
            CancellationToken,
            Task<IReadOnlyList<ChatMessageDto>>> _handler;

        public FakeWorkflowRunner(
            Func<
                RunTurnCommandDto,
                Func<TurnDeltaEventDto, Task>,
                Func<AgentActivityEventDto, Task>,
                CancellationToken,
                Task<IReadOnlyList<ChatMessageDto>>> handler)
        {
            _handler = handler;
        }

        public Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
            RunTurnCommandDto command,
            Func<TurnDeltaEventDto, Task> onDelta,
            Func<AgentActivityEventDto, Task> onActivity,
            CancellationToken cancellationToken)
        {
            return _handler(command, onDelta, onActivity, cancellationToken);
        }
    }
}
