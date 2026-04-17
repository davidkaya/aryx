using System.Text.Json;
using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK.Rpc;

namespace Aryx.AgentHost.Tests;

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
                JsonElement[] runtimeTools = capabilities.GetProperty("runtimeTools").EnumerateArray().ToArray();
                JsonElement runtimeTool = Assert.Single(runtimeTools);
                Assert.Equal("web_fetch", runtimeTool.GetProperty("id").GetString());
                Assert.Equal("web_fetch", runtimeTool.GetProperty("label").GetString());
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
    public async Task InternalConstructor_UsesAgentProviderDefaults()
    {
        FakeWorkflowRunner workflowRunner = new(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
        {
            await onActivity(new AgentActivityEventDto
            {
                Type = "agent-activity",
                RequestId = command.RequestId,
                SessionId = command.SessionId,
                ActivityType = "thinking",
                AgentId = "agent-provider",
                AgentName = "Provider Agent",
            });

            return
            [
                new ChatMessageDto
                {
                    Id = "assistant-provider",
                    Role = "assistant",
                    AuthorName = "Provider Agent",
                    Content = "Hello from the provider.",
                    CreatedAt = "2026-01-01T00:00:00.0000000Z",
                },
            ];
        });
        FakeSessionManager sessionManager = new()
        {
            Sessions =
            [
                new CopilotSessionInfoDto
                {
                    CopilotSessionId = "aryx::provider-session::agent-provider",
                    ManagedByAryx = true,
                    SessionId = "provider-session",
                    AgentId = "agent-provider",
                },
            ],
        };
        SidecarCapabilitiesDto capabilities = new()
        {
            Modes = new Dictionary<string, SidecarModeCapabilityDto>(StringComparer.OrdinalIgnoreCase)
            {
                ["single"] = new() { Available = true },
            },
            Models =
            [
                new SidecarModelCapabilityDto
                {
                    Id = "provider-model",
                    Name = "Provider Model",
                },
            ],
            RuntimeTools = [],
            Connection = new SidecarConnectionDiagnosticsDto
            {
                Status = "ready",
                Summary = "Provider is ready.",
                CheckedAt = "2026-01-01T00:00:00.0000000Z",
            },
        };
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeAgentProvider(workflowRunner, sessionManager, capabilities));

        IReadOnlyList<JsonElement> capabilityEvents = await RunHostAsync(
            new DescribeCapabilitiesCommandDto
            {
                Type = "describe-capabilities",
                RequestId = "provider-capabilities",
            },
            host);
        IReadOnlyList<JsonElement> sessionEvents = await RunHostAsync(
            new ListSessionsCommandDto
            {
                Type = "list-sessions",
                RequestId = "provider-sessions",
            },
            host);
        IReadOnlyList<JsonElement> turnEvents = await RunHostAsync(
            CreateRunTurnCommand(requestId: "provider-turn"),
            host);

        JsonElement capabilityEvent = AssertSingleEvent(capabilityEvents, "capabilities", "provider-capabilities");
        JsonElement model = Assert.Single(capabilityEvent.GetProperty("capabilities").GetProperty("models").EnumerateArray());
        Assert.Equal("provider-model", model.GetProperty("id").GetString());

        JsonElement listedEvent = AssertSingleEvent(sessionEvents, "sessions-listed", "provider-sessions");
        JsonElement session = Assert.Single(listedEvent.GetProperty("sessions").EnumerateArray());
        Assert.Equal("provider-session", session.GetProperty("sessionId").GetString());

        JsonElement turnComplete = AssertSingleEvent(turnEvents, "turn-complete", "provider-turn");
        JsonElement message = Assert.Single(turnComplete.GetProperty("messages").EnumerateArray());
        Assert.Equal("Hello from the provider.", message.GetProperty("content").GetString());
    }

    [Fact]
    public async Task ValidateWorkflowCommand_ReturnsIssuesAndCompletion()
    {
        IReadOnlyList<JsonElement> events = await RunHostAsync(new ValidateWorkflowCommandDto
        {
            Type = "validate-workflow",
            RequestId = "validate-workflow-1",
            Workflow = new WorkflowDefinitionDto
            {
                Id = "workflow-1",
                Name = "",
                Graph = new WorkflowGraphDto
                {
                    Nodes =
                    [
                        new WorkflowNodeDto
                        {
                            Id = "start",
                            Kind = "start",
                            Label = "Start",
                            Config = new WorkflowNodeConfigDto { Kind = "start" },
                        },
                        new WorkflowNodeDto
                        {
                            Id = "end",
                            Kind = "end",
                            Label = "End",
                            Config = new WorkflowNodeConfigDto { Kind = "end" },
                        },
                    ],
                    Edges =
                    [
                        new WorkflowEdgeDto
                        {
                            Id = "edge-start-end",
                            Source = "start",
                            Target = "end",
                            Kind = "direct",
                        },
                    ],
                },
                Settings = new WorkflowSettingsDto
                {
                    Checkpointing = new WorkflowCheckpointSettingsDto(),
                },
            },
        });

        Assert.Collection(
            events,
            validationEvent =>
            {
                Assert.Equal("workflow-validation", validationEvent.GetProperty("type").GetString());
                Assert.Equal("validate-workflow-1", validationEvent.GetProperty("requestId").GetString());

                JsonElement[] issues = validationEvent.GetProperty("issues").EnumerateArray().ToArray();
                Assert.Contains(issues, issue =>
                    issue.GetProperty("field").GetString() == "name"
                    && issue.GetProperty("message").GetString() == "Workflow name is required.");
                Assert.Contains(issues, issue =>
                    issue.GetProperty("field").GetString() == "graph.nodes"
                    && issue.GetProperty("message").GetString() == "Workflow graphs must contain at least one executable work node.");
            },
            completionEvent =>
            {
                Assert.Equal("command-complete", completionEvent.GetProperty("type").GetString());
                Assert.Equal("validate-workflow-1", completionEvent.GetProperty("requestId").GetString());
            });
    }

    [Fact]
    public async Task RunTurnCommand_ReturnsActivityEventsAndCompletion()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
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
                    Content = "Hello",
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

        IReadOnlyList<JsonElement> events = await RunHostAsync(CreateRunTurnCommand(), host);

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
                Assert.Equal("Hello", deltaEvent.GetProperty("content").GetString());
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
                Assert.False(completionEvent.GetProperty("cancelled").GetBoolean());
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
    public async Task RunTurnCommand_ReturnsWorkflowDiagnosticEventsAndCompletion()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
            {
                await onActivity(new WorkflowDiagnosticEventDto
                {
                    Type = "workflow-diagnostic",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    Severity = "error",
                    DiagnosticKind = "executor-failed",
                    Message = "Tool crashed.",
                    AgentId = "agent-1",
                    AgentName = "Primary",
                    ExecutorId = "agent-1",
                    ExceptionType = "InvalidOperationException",
                });

                return [];
            }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            CreateRunTurnCommand(requestId: "turn-diagnostic", messages: []),
            host);

        Assert.Collection(
            events,
            diagnosticEvent =>
            {
                Assert.Equal("workflow-diagnostic", diagnosticEvent.GetProperty("type").GetString());
                Assert.Equal("turn-diagnostic", diagnosticEvent.GetProperty("requestId").GetString());
                Assert.Equal("session-1", diagnosticEvent.GetProperty("sessionId").GetString());
                Assert.Equal("error", diagnosticEvent.GetProperty("severity").GetString());
                Assert.Equal("executor-failed", diagnosticEvent.GetProperty("diagnosticKind").GetString());
                Assert.Equal("Tool crashed.", diagnosticEvent.GetProperty("message").GetString());
                Assert.Equal("agent-1", diagnosticEvent.GetProperty("executorId").GetString());
            },
            completionEvent =>
            {
                Assert.Equal("turn-complete", completionEvent.GetProperty("type").GetString());
                Assert.Equal("session-1", completionEvent.GetProperty("sessionId").GetString());
                Assert.False(completionEvent.GetProperty("cancelled").GetBoolean());
            },
            commandCompleteEvent =>
            {
                Assert.Equal("command-complete", commandCompleteEvent.GetProperty("type").GetString());
                Assert.Equal("turn-diagnostic", commandCompleteEvent.GetProperty("requestId").GetString());
            });
    }

    [Fact]
    public async Task RunTurnCommand_DeserializesInteractionMode()
    {
        string? capturedMode = null;
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
            {
                capturedMode = command.Mode;
                return [];
            }));

        await RunHostAsync(
            CreateRunTurnCommand(requestId: "turn-plan", interactionMode: "plan"),
            host);

        Assert.Equal("plan", capturedMode);
    }

    [Fact]
    public async Task RunTurnCommand_ReturnsApprovalEvents()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
            {
                await onApproval(new ApprovalRequestedEventDto
                {
                    Type = "approval-requested",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    ApprovalId = "approval-1",
                    ApprovalKind = "tool-call",
                    AgentId = "agent-1",
                    AgentName = "Primary",
                    PermissionKind = "tool access",
                    ApprovalToolKey = "shell",
                    Title = "Approve tool access",
                    PermissionDetail = new PermissionDetailDto
                    {
                        Kind = "shell",
                        Command = "git status",
                        Intention = "Inspect repository state",
                        PossiblePaths = ["README.md"],
                    },
                });

                return [];
            }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            CreateRunTurnCommand(requestId: "turn-approval"),
            host);

        Assert.Collection(
            events,
            approvalEvent =>
            {
                Assert.Equal("approval-requested", approvalEvent.GetProperty("type").GetString());
                Assert.Equal("turn-approval", approvalEvent.GetProperty("requestId").GetString());
                Assert.Equal("approval-1", approvalEvent.GetProperty("approvalId").GetString());
                Assert.Equal("tool-call", approvalEvent.GetProperty("approvalKind").GetString());
                Assert.Equal("shell", approvalEvent.GetProperty("approvalToolKey").GetString());
                Assert.Equal("Approve tool access", approvalEvent.GetProperty("title").GetString());
                JsonElement permissionDetail = approvalEvent.GetProperty("permissionDetail");
                Assert.Equal("shell", permissionDetail.GetProperty("kind").GetString());
                Assert.Equal("git status", permissionDetail.GetProperty("command").GetString());
                Assert.Equal("Inspect repository state", permissionDetail.GetProperty("intention").GetString());
                Assert.Equal("README.md", Assert.Single(permissionDetail.GetProperty("possiblePaths").EnumerateArray()).GetString());
            },
            completionEvent =>
            {
                Assert.Equal("turn-complete", completionEvent.GetProperty("type").GetString());
                Assert.False(completionEvent.GetProperty("cancelled").GetBoolean());
            },
            commandCompleteEvent =>
            {
                Assert.Equal("command-complete", commandCompleteEvent.GetProperty("type").GetString());
                Assert.Equal("turn-approval", commandCompleteEvent.GetProperty("requestId").GetString());
            });
    }

    [Fact]
    public async Task RunTurnCommand_ReturnsUserInputEvents()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
            {
                await onUserInput(new UserInputRequestedEventDto
                {
                    Type = "user-input-requested",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    UserInputId = "user-input-1",
                    AgentId = "agent-1",
                    AgentName = "Primary",
                    Question = "What should I do next?",
                    Choices = ["Continue", "Stop"],
                    AllowFreeform = true,
                });

                return [];
            }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            CreateRunTurnCommand(requestId: "turn-user-input"),
            host);

        Assert.Collection(
            events,
            userInputEvent =>
            {
                Assert.Equal("user-input-requested", userInputEvent.GetProperty("type").GetString());
                Assert.Equal("turn-user-input", userInputEvent.GetProperty("requestId").GetString());
                Assert.Equal("session-1", userInputEvent.GetProperty("sessionId").GetString());
                Assert.Equal("user-input-1", userInputEvent.GetProperty("userInputId").GetString());
                Assert.Equal("Primary", userInputEvent.GetProperty("agentName").GetString());
                Assert.Equal("What should I do next?", userInputEvent.GetProperty("question").GetString());
                string[] choices = userInputEvent.GetProperty("choices")
                    .EnumerateArray()
                    .Select(choice => choice.GetString() ?? string.Empty)
                    .ToArray();
                Assert.Equal(["Continue", "Stop"], choices);
                Assert.True(userInputEvent.GetProperty("allowFreeform").GetBoolean());
            },
            completionEvent =>
            {
                Assert.Equal("turn-complete", completionEvent.GetProperty("type").GetString());
                Assert.False(completionEvent.GetProperty("cancelled").GetBoolean());
            },
            commandCompleteEvent =>
            {
                Assert.Equal("command-complete", commandCompleteEvent.GetProperty("type").GetString());
                Assert.Equal("turn-user-input", commandCompleteEvent.GetProperty("requestId").GetString());
            });
    }

    [Fact]
    public async Task RunTurnCommand_ReturnsMcpOauthRequiredEvents()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
            {
                await onMcpOAuthRequired(new McpOauthRequiredEventDto
                {
                    Type = "mcp-oauth-required",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    OauthRequestId = "oauth-request-1",
                    AgentId = "agent-1",
                    AgentName = "Primary",
                    ServerName = "Example MCP",
                    ServerUrl = "https://example.com/mcp",
                    StaticClientConfig = new McpOauthStaticClientConfigDto
                    {
                        ClientId = "aryx-client",
                        PublicClient = true,
                    },
                });

                return [];
            }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            CreateRunTurnCommand(requestId: "turn-mcp-oauth"),
            host);

        Assert.Collection(
            events,
            oauthEvent =>
            {
                Assert.Equal("mcp-oauth-required", oauthEvent.GetProperty("type").GetString());
                Assert.Equal("turn-mcp-oauth", oauthEvent.GetProperty("requestId").GetString());
                Assert.Equal("session-1", oauthEvent.GetProperty("sessionId").GetString());
                Assert.Equal("oauth-request-1", oauthEvent.GetProperty("oauthRequestId").GetString());
                Assert.Equal("Primary", oauthEvent.GetProperty("agentName").GetString());
                Assert.Equal("Example MCP", oauthEvent.GetProperty("serverName").GetString());
                Assert.Equal("https://example.com/mcp", oauthEvent.GetProperty("serverUrl").GetString());
                JsonElement staticClientConfig = oauthEvent.GetProperty("staticClientConfig");
                Assert.Equal("aryx-client", staticClientConfig.GetProperty("clientId").GetString());
                Assert.True(staticClientConfig.GetProperty("publicClient").GetBoolean());
            },
            completionEvent =>
            {
                Assert.Equal("turn-complete", completionEvent.GetProperty("type").GetString());
                Assert.False(completionEvent.GetProperty("cancelled").GetBoolean());
            },
            commandCompleteEvent =>
            {
                Assert.Equal("command-complete", commandCompleteEvent.GetProperty("type").GetString());
                Assert.Equal("turn-mcp-oauth", commandCompleteEvent.GetProperty("requestId").GetString());
            });
    }

    [Fact]
    public async Task RunTurnCommand_ReturnsExitPlanModeEvents()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
            {
                await onExitPlanMode(new ExitPlanModeRequestedEventDto
                {
                    Type = "exit-plan-mode-requested",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    ExitPlanId = "exit-plan-1",
                    AgentId = "agent-1",
                    AgentName = "Primary",
                    Summary = "Proposed implementation plan",
                    PlanContent = "1. Inspect\n2. Change\n3. Validate",
                    Actions = ["interactive", "autopilot"],
                    RecommendedAction = "interactive",
                });

                return [];
            }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            CreateRunTurnCommand(requestId: "turn-plan-mode", interactionMode: "plan"),
            host);

        Assert.Collection(
            events,
            exitPlanEvent =>
            {
                Assert.Equal("exit-plan-mode-requested", exitPlanEvent.GetProperty("type").GetString());
                Assert.Equal("turn-plan-mode", exitPlanEvent.GetProperty("requestId").GetString());
                Assert.Equal("exit-plan-1", exitPlanEvent.GetProperty("exitPlanId").GetString());
                Assert.Equal("Primary", exitPlanEvent.GetProperty("agentName").GetString());
                Assert.Equal("Proposed implementation plan", exitPlanEvent.GetProperty("summary").GetString());
                Assert.Equal("1. Inspect\n2. Change\n3. Validate", exitPlanEvent.GetProperty("planContent").GetString());
                string[] actions = exitPlanEvent.GetProperty("actions")
                    .EnumerateArray()
                    .Select(action => action.GetString() ?? string.Empty)
                    .ToArray();
                Assert.Equal(["interactive", "autopilot"], actions);
                Assert.Equal("interactive", exitPlanEvent.GetProperty("recommendedAction").GetString());
            },
            completionEvent =>
            {
                Assert.Equal("turn-complete", completionEvent.GetProperty("type").GetString());
                Assert.False(completionEvent.GetProperty("cancelled").GetBoolean());
            },
            commandCompleteEvent =>
            {
                Assert.Equal("command-complete", commandCompleteEvent.GetProperty("type").GetString());
                Assert.Equal("turn-plan-mode", commandCompleteEvent.GetProperty("requestId").GetString());
            });
    }

    [Fact]
    public async Task CancelTurnCommand_CancelsInProgressTurnAndCompletesBothCommands()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
            {
                await Task.Delay(Timeout.Infinite, cancellationToken);
                return [];
            }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            [
                CreateRunTurnCommand(requestId: "turn-cancel"),
                new CancelTurnCommandDto
                {
                    Type = "cancel-turn",
                    RequestId = "cancel-command-1",
                    TargetRequestId = "turn-cancel",
                },
            ],
            host);

        JsonElement turnCompleteEvent = AssertSingleEvent(events, "turn-complete", "turn-cancel");
        Assert.Equal("session-1", turnCompleteEvent.GetProperty("sessionId").GetString());
        Assert.True(turnCompleteEvent.GetProperty("cancelled").GetBoolean());
        Assert.Empty(turnCompleteEvent.GetProperty("messages").EnumerateArray().ToArray());

        AssertSingleEvent(events, "command-complete", "turn-cancel");
        AssertSingleEvent(events, "command-complete", "cancel-command-1");
        Assert.DoesNotContain(events, evt => evt.GetProperty("type").GetString() == "command-error");
    }

    [Fact]
    public async Task CancelTurnCommand_UnknownTarget_CompletesWithoutError()
    {
        IReadOnlyList<JsonElement> events = await RunHostAsync(new CancelTurnCommandDto
        {
            Type = "cancel-turn",
            RequestId = "cancel-command-unknown",
            TargetRequestId = "missing-turn",
        });

        JsonElement completionEvent = Assert.Single(events);
        Assert.Equal("command-complete", completionEvent.GetProperty("type").GetString());
        Assert.Equal("cancel-command-unknown", completionEvent.GetProperty("requestId").GetString());
    }

    [Fact]
    public async Task CancelTurnCommand_AfterTurnCompletion_IsNoOp()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) => []));

        await RunHostAsync(CreateRunTurnCommand(requestId: "turn-completed"), host);

        IReadOnlyList<JsonElement> events = await RunHostAsync(new CancelTurnCommandDto
        {
            Type = "cancel-turn",
            RequestId = "cancel-command-completed",
            TargetRequestId = "turn-completed",
        }, host);

        JsonElement completionEvent = Assert.Single(events);
        Assert.Equal("command-complete", completionEvent.GetProperty("type").GetString());
        Assert.Equal("cancel-command-completed", completionEvent.GetProperty("requestId").GetString());
    }

    [Fact]
    public async Task ResolveApprovalCommand_DelegatesToWorkflowRunnerAndCompletes()
    {
        ResolveApprovalCommandDto? captured = null;
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(
                handler: async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) => [],
                resolveApprovalHandler: (command, cancellationToken) =>
                {
                    captured = command;
                    return Task.CompletedTask;
                }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            new ResolveApprovalCommandDto
            {
                Type = "resolve-approval",
                RequestId = "approval-command-1",
                ApprovalId = "approval-1",
                Decision = "approved",
                AlwaysApprove = true,
            },
            host);

        JsonElement completionEvent = Assert.Single(events);
        Assert.Equal("command-complete", completionEvent.GetProperty("type").GetString());
        Assert.Equal("approval-command-1", completionEvent.GetProperty("requestId").GetString());
        Assert.Equal("approval-1", captured?.ApprovalId);
        Assert.Equal("approved", captured?.Decision);
        Assert.True(captured?.AlwaysApprove ?? false);
    }

    [Fact]
    public async Task ResolveUserInputCommand_DelegatesToWorkflowRunnerAndCompletes()
    {
        ResolveUserInputCommandDto? captured = null;
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            new FakeWorkflowRunner(
                handler: async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) => [],
                resolveUserInputHandler: (command, cancellationToken) =>
                {
                    captured = command;
                    return Task.CompletedTask;
                }));

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            new ResolveUserInputCommandDto
            {
                Type = "resolve-user-input",
                RequestId = "user-input-command-1",
                UserInputId = "user-input-1",
                Answer = "Continue",
                WasFreeform = false,
            },
            host);

        JsonElement completionEvent = Assert.Single(events);
        Assert.Equal("command-complete", completionEvent.GetProperty("type").GetString());
        Assert.Equal("user-input-command-1", completionEvent.GetProperty("requestId").GetString());
        Assert.Equal("user-input-1", captured?.UserInputId);
        Assert.Equal("Continue", captured?.Answer);
        Assert.False(captured?.WasFreeform);
    }

    [Fact]
    public void MapRuntimeTools_ExcludesOnlyInternalMetaToolsAndDeduplicatesByName()
    {
        IReadOnlyList<SidecarRuntimeToolDto> runtimeTools = CopilotAgentProvider.MapRuntimeTools(
        [
            new Tool
            {
                Name = "ask_user",
                Description = "Ask the user a question.",
            },
            new Tool
            {
                Name = "report_intent",
                Description = "Report current intent.",
            },
            new Tool
            {
                Name = "task_complete",
                Description = "Signal task completion.",
            },
            new Tool
            {
                Name = "exit_plan_mode",
                Description = "Exit plan mode.",
            },
            new Tool
            {
                Name = " web_fetch ",
                Description = " Fetch content from the web. ",
            },
            new Tool
            {
                Name = "WEB_FETCH",
                Description = "Duplicate entry",
            },
        ]);

        Assert.Collection(
            runtimeTools,
            exitPlanTool =>
            {
                Assert.Equal("exit_plan_mode", exitPlanTool.Id);
                Assert.Equal("exit_plan_mode", exitPlanTool.Label);
                Assert.Equal("Exit plan mode.", exitPlanTool.Description);
            },
            runtimeTool =>
            {
                Assert.Equal("web_fetch", runtimeTool.Id);
                Assert.Equal("web_fetch", runtimeTool.Label);
                Assert.Equal("Fetch content from the web.", runtimeTool.Description);
            });
    }

    [Fact]
    public void ClassifyConnectionStatus_ReturnsAuthRequiredForLoginFailures()
    {
        string status = CopilotAgentProvider.ClassifyConnectionStatus(
            new InvalidOperationException("Please run copilot auth login to continue."));

        Assert.Equal("copilot-auth-required", status);
    }

    [Fact]
    public void CreateReadyConnectionDiagnostics_ReportsCliPathAndModelCount()
    {
        SidecarConnectionDiagnosticsDto diagnostics =
            CopilotAgentProvider.CreateReadyConnectionDiagnostics(
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

    [Fact]
    public async Task ListSessionsCommand_ReturnsSessionsListedEvent()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            sessionManager: new FakeSessionManager
            {
                Sessions =
                [
                    new CopilotSessionInfoDto
                    {
                        CopilotSessionId = "aryx::session-1::agent-1",
                        ManagedByAryx = true,
                        SessionId = "session-1",
                        AgentId = "agent-1",
                        Summary = "Review session",
                    },
                ],
            });

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            new ListSessionsCommandDto
            {
                Type = "list-sessions",
                RequestId = "list-1",
            },
            host);

        JsonElement listedEvent = AssertSingleEvent(events, "sessions-listed", "list-1");
        JsonElement session = Assert.Single(listedEvent.GetProperty("sessions").EnumerateArray());
        Assert.Equal("aryx::session-1::agent-1", session.GetProperty("copilotSessionId").GetString());
        Assert.Equal("session-1", session.GetProperty("sessionId").GetString());
    }

    [Fact]
    public async Task DeleteSessionCommand_ReturnsDeletedSessionsEvent()
    {
        FakeSessionManager sessionManager = new()
        {
            DeletedSessions =
            [
                new CopilotSessionInfoDto
                {
                    CopilotSessionId = "aryx::session-1::agent-1",
                    ManagedByAryx = true,
                    SessionId = "session-1",
                    AgentId = "agent-1",
                },
            ],
        };
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            sessionManager: sessionManager);

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            new DeleteSessionCommandDto
            {
                Type = "delete-session",
                RequestId = "delete-1",
                SessionId = "session-1",
            },
            host);

        JsonElement deletedEvent = AssertSingleEvent(events, "sessions-deleted", "delete-1");
        JsonElement session = Assert.Single(deletedEvent.GetProperty("sessions").EnumerateArray());
        Assert.Equal("session-1", deletedEvent.GetProperty("sessionId").GetString());
        Assert.Equal("aryx::session-1::agent-1", session.GetProperty("copilotSessionId").GetString());
        Assert.Equal("session-1", sessionManager.DeletedAryxSessionId);
    }

    [Fact]
    public async Task GetQuotaCommand_ReturnsQuotaResultEvent()
    {
        SidecarProtocolHost host = new(
            new WorkflowValidator(),
            sessionManager: new FakeSessionManager
            {
                QuotaSnapshots = new Dictionary<string, QuotaSnapshotDto>(StringComparer.Ordinal)
                {
                    ["premium_interactions"] = new()
                    {
                        EntitlementRequests = 50,
                        UsedRequests = 12,
                        RemainingPercentage = 76,
                        Overage = 0,
                        OverageAllowedWithExhaustedQuota = true,
                        ResetDate = "2026-04-01T00:00:00Z",
                    },
                },
            });

        IReadOnlyList<JsonElement> events = await RunHostAsync(
            new GetQuotaCommandDto
            {
                Type = "get-quota",
                RequestId = "quota-1",
            },
            host);

        JsonElement quotaEvent = AssertSingleEvent(events, "quota-result", "quota-1");
        JsonElement snapshot = quotaEvent.GetProperty("quotaSnapshots").GetProperty("premium_interactions");
        Assert.Equal(50, snapshot.GetProperty("entitlementRequests").GetDouble());
        Assert.Equal(12, snapshot.GetProperty("usedRequests").GetDouble());
        Assert.Equal(76, snapshot.GetProperty("remainingPercentage").GetDouble());
        Assert.True(snapshot.GetProperty("overageAllowedWithExhaustedQuota").GetBoolean());
        Assert.Equal("2026-04-01T00:00:00Z", snapshot.GetProperty("resetDate").GetString());
    }

    [Fact]
    public async Task DisconnectSessionCommand_CancelsActiveTurnsForSession()
    {
        FakeWorkflowRunner runner = new(async (command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            return [];
        });
        SidecarProtocolHost host = new(new WorkflowValidator(), runner);

        IReadOnlyList<JsonElement> events = await RunHostAsync(
        [
            CreateRunTurnCommand(requestId: "turn-1", sessionId: "session-1"),
            new DisconnectSessionCommandDto
            {
                Type = "disconnect-session",
                RequestId = "disconnect-1",
                SessionId = "session-1",
            },
        ],
        host);

        JsonElement disconnectedEvent = AssertSingleEvent(events, "session-disconnected", "disconnect-1");
        string[] cancelledRequestIds = disconnectedEvent.GetProperty("cancelledRequestIds")
            .EnumerateArray()
            .Select(value => value.GetString() ?? string.Empty)
            .ToArray();
        Assert.Equal(["turn-1"], cancelledRequestIds);

        JsonElement turnComplete = AssertSingleEvent(events, "turn-complete", "turn-1");
        Assert.True(turnComplete.GetProperty("cancelled").GetBoolean());
    }

    private static async Task<IReadOnlyList<JsonElement>> RunHostAsync(
        object command,
        SidecarProtocolHost? host = null)
    {
        return await RunHostAsync([command], host);
    }

    private static async Task<IReadOnlyList<JsonElement>> RunHostAsync(
        IReadOnlyList<object> commands,
        SidecarProtocolHost? host = null)
    {
        string input = string.Join(
                Environment.NewLine,
                commands.Select(command => JsonSerializer.Serialize(command, JsonOptions)))
            + Environment.NewLine;

        using StringReader reader = new(input);
        using StringWriter writer = new();

        await (host ?? CreateHostForTests()).RunAsync(reader, writer, CancellationToken.None);
        return ParseEvents(writer.ToString());
    }

    private static JsonElement AssertSingleEvent(
        IEnumerable<JsonElement> events,
        string eventType,
        string requestId)
    {
        return Assert.Single(events, evt =>
            evt.GetProperty("type").GetString() == eventType
            && evt.GetProperty("requestId").GetString() == requestId);
    }

    private static SidecarProtocolHost CreateHostForTests()
    {
        return new SidecarProtocolHost(
            new WorkflowValidator(),
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
                RuntimeTools =
                [
                    new SidecarRuntimeToolDto
                    {
                        Id = "web_fetch",
                        Label = "web_fetch",
                        Description = "Fetch content from the web.",
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

    private static WorkflowNodeDto CreateAgent(
        string id = "agent-1",
        string name = "Primary",
        string model = "gpt-5.4",
        string instructions = "Help with the user's request.")
    {
        return new WorkflowNodeDto
        {
            Id = id,
            Kind = "agent",
            Label = name,
            Config = new WorkflowNodeConfigDto
            {
                Kind = "agent",
                Id = id,
                Name = name,
                Model = model,
                Instructions = instructions,
            },
        };
    }

    private static RunTurnCommandDto CreateRunTurnCommand(
        string requestId = "turn-1",
        string sessionId = "session-1",
        string mode = "single",
        string interactionMode = "interactive",
        IReadOnlyList<WorkflowNodeDto>? agents = null,
        IReadOnlyList<ChatMessageDto>? messages = null)
    {
        return new RunTurnCommandDto
        {
            Type = "run-turn",
            RequestId = requestId,
            SessionId = sessionId,
            ProjectPath = "C:\\workspace\\project",
            Mode = interactionMode,
            Workflow = CreateWorkflow(mode, agents),
            Messages = messages ??
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
        };
    }

    private static WorkflowDefinitionDto CreateWorkflow(
        string mode = "single",
        IReadOnlyList<WorkflowNodeDto>? agents = null)
    {
        return new WorkflowDefinitionDto
        {
            Id = $"workflow-{mode}",
            Name = "Single Agent",
            Graph = new WorkflowGraphDto
            {
                Nodes = [.. agents ?? [CreateAgent(name: "Primary")]],
            },
            Settings = new WorkflowSettingsDto
            {
                OrchestrationMode = mode,
            },
        };
    }

    private sealed class FakeWorkflowRunner : ITurnWorkflowRunner
    {
        private readonly Func<
            RunTurnCommandDto,
            Func<TurnDeltaEventDto, Task>,
            Func<SidecarEventDto, Task>,
            Func<ApprovalRequestedEventDto, Task>,
            Func<UserInputRequestedEventDto, Task>,
            Func<McpOauthRequiredEventDto, Task>,
            Func<ExitPlanModeRequestedEventDto, Task>,
            CancellationToken,
            Task<IReadOnlyList<ChatMessageDto>>> _handler;
        private readonly Func<ResolveApprovalCommandDto, CancellationToken, Task> _resolveApprovalHandler;
        private readonly Func<ResolveUserInputCommandDto, CancellationToken, Task> _resolveUserInputHandler;

        public FakeWorkflowRunner(
            Func<
                RunTurnCommandDto,
                Func<TurnDeltaEventDto, Task>,
                Func<SidecarEventDto, Task>,
                Func<ApprovalRequestedEventDto, Task>,
                Func<UserInputRequestedEventDto, Task>,
                Func<McpOauthRequiredEventDto, Task>,
                Func<ExitPlanModeRequestedEventDto, Task>,
                CancellationToken,
                Task<IReadOnlyList<ChatMessageDto>>> handler,
            Func<ResolveApprovalCommandDto, CancellationToken, Task>? resolveApprovalHandler = null,
            Func<ResolveUserInputCommandDto, CancellationToken, Task>? resolveUserInputHandler = null)
        {
            _handler = handler;
            _resolveApprovalHandler = resolveApprovalHandler ?? ((_, _) => Task.CompletedTask);
            _resolveUserInputHandler = resolveUserInputHandler ?? ((_, _) => Task.CompletedTask);
        }

        public Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
            RunTurnCommandDto command,
            Func<TurnDeltaEventDto, Task> onDelta,
            Func<SidecarEventDto, Task> onActivity,
            Func<ApprovalRequestedEventDto, Task> onApproval,
            Func<UserInputRequestedEventDto, Task> onUserInput,
            Func<McpOauthRequiredEventDto, Task> onMcpOAuthRequired,
            Func<ExitPlanModeRequestedEventDto, Task> onExitPlanMode,
            CancellationToken cancellationToken)
        {
            return _handler(command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, cancellationToken);
        }

        public Task ResolveApprovalAsync(
            ResolveApprovalCommandDto command,
            CancellationToken cancellationToken)
        {
            return _resolveApprovalHandler(command, cancellationToken);
        }

        public Task ResolveUserInputAsync(
            ResolveUserInputCommandDto command,
            CancellationToken cancellationToken)
        {
            return _resolveUserInputHandler(command, cancellationToken);
        }
    }

    private sealed class FakeAgentProvider : IAgentProvider
    {
        private readonly ITurnWorkflowRunner _workflowRunner;
        private readonly IProviderSessionManager _sessionManager;
        private readonly SidecarCapabilitiesDto _capabilities;

        public FakeAgentProvider(
            ITurnWorkflowRunner workflowRunner,
            IProviderSessionManager sessionManager,
            SidecarCapabilitiesDto capabilities)
        {
            _workflowRunner = workflowRunner;
            _sessionManager = sessionManager;
            _capabilities = capabilities;
        }

        public ITurnWorkflowRunner CreateWorkflowRunner(WorkflowValidator workflowValidator)
        {
            return _workflowRunner;
        }

        public Task<SidecarCapabilitiesDto> GetCapabilitiesAsync(CancellationToken cancellationToken)
        {
            return Task.FromResult(_capabilities);
        }

        public IProviderSessionManager CreateSessionManager()
        {
            return _sessionManager;
        }
    }

    private sealed class FakeSessionManager : ICopilotSessionManager
    {
        public IReadOnlyList<CopilotSessionInfoDto> Sessions { get; init; } = [];

        public IReadOnlyList<CopilotSessionInfoDto> DeletedSessions { get; init; } = [];

        public IReadOnlyDictionary<string, QuotaSnapshotDto> QuotaSnapshots { get; init; }
            = new Dictionary<string, QuotaSnapshotDto>(StringComparer.Ordinal);

        public string? DeletedAryxSessionId { get; private set; }

        public string? DeletedCopilotSessionId { get; private set; }

        public Task<IReadOnlyList<CopilotSessionInfoDto>> ListSessionsAsync(
            CopilotSessionListFilterDto? filter,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(Sessions);
        }

        public Task<IReadOnlyList<CopilotSessionInfoDto>> DeleteSessionsAsync(
            string? aryxSessionId,
            string? copilotSessionId,
            CancellationToken cancellationToken)
        {
            DeletedAryxSessionId = aryxSessionId;
            DeletedCopilotSessionId = copilotSessionId;
            return Task.FromResult(DeletedSessions);
        }

        public Task<IReadOnlyDictionary<string, QuotaSnapshotDto>> GetQuotaAsync(
            CancellationToken cancellationToken)
        {
            return Task.FromResult(QuotaSnapshots);
        }
    }
}

