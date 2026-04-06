using System.Text.Json;
using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotSessionHooksTests
{
    [Fact]
    public async Task Create_FileBasedPreToolUseDenyOverridesApprovalPolicy()
    {
        RunTurnCommandDto command = CreateCommandWithToolApproval();
        RecordingHookCommandRunner runner = new(
        [
            """{"permissionDecision":"deny","permissionDecisionReason":"Blocked by repository hook"}""",
        ]);
        ResolvedHookSet configuredHooks = new()
        {
            PreToolUse =
            [
                CreateHookCommand("deny-pre-tool"),
            ],
        };

        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], configuredHooks, runner);

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                Timestamp = 1710000000000,
                Cwd = command.ProjectPath,
                ToolName = "view",
                ToolArgs = JsonSerializer.SerializeToElement(new
                {
                    path = "README.md",
                }),
            },
            null!);

        Assert.Equal("deny", decision?.PermissionDecision);
        Assert.Equal("Blocked by repository hook", decision?.PermissionDecisionReason);

        RecordedHookInvocation invocation = Assert.Single(runner.Invocations);
        JsonDocument payload = JsonDocument.Parse(invocation.InputJson);
        Assert.Equal("view", payload.RootElement.GetProperty("toolName").GetString());
        Assert.Equal("{\"path\":\"README.md\"}", payload.RootElement.GetProperty("toolArgs").GetString());
        Assert.Equal(command.ProjectPath, invocation.ProjectPath);
    }

    [Fact]
    public async Task Create_PreToolUseFallsThroughWhenFileHooksDoNotDeny()
    {
        RunTurnCommandDto command = CreateCommandWithToolApproval();
        RecordingHookCommandRunner runner = new(
        [
            """{"permissionDecision":"allow"}""",
        ]);
        ResolvedHookSet configuredHooks = new()
        {
            PreToolUse =
            [
                CreateHookCommand("allow-pre-tool"),
            ],
        };

        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], configuredHooks, runner);

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = "view",
            },
            null!);

        Assert.Equal("ask", decision?.PermissionDecision);
        Assert.Single(runner.Invocations);
    }

    [Fact]
    public async Task Create_PreToolUseIgnoresInvalidHookOutputAndFallsThrough()
    {
        RunTurnCommandDto command = CreateCommandWithToolApproval();
        RecordingHookCommandRunner runner = new(
        [
            "not-json",
        ]);
        ResolvedHookSet configuredHooks = new()
        {
            PreToolUse =
            [
                CreateHookCommand("invalid-pre-tool"),
            ],
        };

        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], configuredHooks, runner);

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = "view",
            },
            null!);

        Assert.Equal("ask", decision?.PermissionDecision);
        Assert.Single(runner.Invocations);
    }

    [Theory]
    [InlineData("ask_user")]
    [InlineData("exit_plan_mode")]
    [InlineData("fetch_copilot_cli_documentation")]
    [InlineData("list_agents")]
    [InlineData("read_agent")]
    [InlineData("report_intent")]
    [InlineData("skill")]
    [InlineData("sql")]
    [InlineData("task")]
    [InlineData("task_complete")]
    [InlineData("update_todo")]
    [InlineData("handoff_to_2")]
    [InlineData("handoff_to_specialist")]
    public async Task Create_PreToolUseAutoAllowsInternalOrchestrationTools(string toolName)
    {
        RunTurnCommandDto command = CreateCommandWithToolApproval();
        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], ResolvedHookSet.Empty, new RecordingHookCommandRunner());

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = toolName,
            },
            null!);

        Assert.Equal("allow", decision?.PermissionDecision);
    }

    [Fact]
    public async Task Create_PreToolUseKeepsStoreMemoryUnderApprovalPolicy()
    {
        RunTurnCommandDto command = CreateCommandWithToolApproval();
        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], ResolvedHookSet.Empty, new RecordingHookCommandRunner());

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = "store_memory",
            },
            null!);

        Assert.Equal("ask", decision?.PermissionDecision);
    }

    [Theory]
    [InlineData("view", "read")]
    [InlineData("grep", "read")]
    [InlineData("edit", "write")]
    [InlineData("powershell", "shell")]
    public async Task Create_PreToolUseAutoAllowsWhenCategoryIsApproved(string toolName, string category)
    {
        RunTurnCommandDto command = CreateCommandWithAutoApprovedCategory(category);
        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], ResolvedHookSet.Empty, new RecordingHookCommandRunner());

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = toolName,
            },
            null!);

        Assert.Equal("allow", decision?.PermissionDecision);
    }

    [Fact]
    public async Task Create_PreToolUseAutoAllowsWhenMcpServerIsApproved()
    {
        RunTurnCommandDto command = CreateCommandWithConfiguredMcpServers(
            ["icm-mcp"],
            ["mcp_server:icm-mcp"]);
        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], ResolvedHookSet.Empty, new RecordingHookCommandRunner());

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = "icm-mcp-get_incident_details_by_id",
            },
            null!);

        Assert.Equal("allow", decision?.PermissionDecision);
    }

    [Fact]
    public async Task Create_PreToolUseRequiresApprovalWhenMcpServerIsNotApproved()
    {
        RunTurnCommandDto command = CreateCommandWithConfiguredMcpServers(["icm-mcp"]);
        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], ResolvedHookSet.Empty, new RecordingHookCommandRunner());

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = "icm-mcp-get_incident_details_by_id",
            },
            null!);

        Assert.Equal("ask", decision?.PermissionDecision);
    }

    [Fact]
    public async Task Create_RunsConfiguredNonPreToolHooks()
    {
        RunTurnCommandDto command = CreateCommandWithoutApprovalRules();
        RecordingHookCommandRunner runner = new();
        ResolvedHookSet configuredHooks = new()
        {
            SessionStart = [CreateHookCommand("session-start-hook")],
            UserPromptSubmitted = [CreateHookCommand("prompt-hook")],
            PostToolUse = [CreateHookCommand("post-tool-hook")],
            SessionEnd = [CreateHookCommand("session-end-hook")],
            ErrorOccurred = [CreateHookCommand("error-hook")],
        };

        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], configuredHooks, runner);

        await hooks.OnSessionStart!(
            new SessionStartHookInput
            {
                Timestamp = 1,
                Cwd = command.ProjectPath,
                Source = "new",
                InitialPrompt = "Create the feature",
            },
            null!);
        await hooks.OnUserPromptSubmitted!(
            new UserPromptSubmittedHookInput
            {
                Timestamp = 2,
                Cwd = command.ProjectPath,
                Prompt = "Refactor the API",
            },
            null!);
        await hooks.OnPostToolUse!(
            new PostToolUseHookInput
            {
                Timestamp = 3,
                Cwd = command.ProjectPath,
                ToolName = "view",
                ToolArgs = JsonSerializer.SerializeToElement(new
                {
                    path = "README.md",
                }),
                ToolResult = JsonSerializer.SerializeToElement(new
                {
                    resultType = "success",
                    textResultForLlm = "Read 1 file",
                }),
            },
            null!);
        await hooks.OnSessionEnd!(
            new SessionEndHookInput
            {
                Timestamp = 4,
                Cwd = command.ProjectPath,
                Reason = "complete",
                FinalMessage = "Done",
            },
            null!);
        await hooks.OnErrorOccurred!(
            new ErrorOccurredHookInput
            {
                Timestamp = 5,
                Cwd = command.ProjectPath,
                Error = "Network timeout",
                ErrorContext = "tool_execution",
                Recoverable = true,
            },
            null!);

        Assert.Equal(
            ["session-start-hook", "prompt-hook", "post-tool-hook", "session-end-hook", "error-hook"],
            runner.Invocations.Select(invocation => GetCommandText(invocation.Hook)).ToArray());

        JsonDocument postToolPayload = JsonDocument.Parse(runner.Invocations[2].InputJson);
        Assert.Equal("view", postToolPayload.RootElement.GetProperty("toolName").GetString());
        Assert.Equal("success", postToolPayload.RootElement.GetProperty("toolResult").GetProperty("resultType").GetString());

        JsonDocument errorPayload = JsonDocument.Parse(runner.Invocations[4].InputJson);
        Assert.Equal("Network timeout", errorPayload.RootElement.GetProperty("error").GetProperty("message").GetString());
        Assert.Equal("tool_execution", errorPayload.RootElement.GetProperty("error").GetProperty("context").GetString());
        Assert.True(errorPayload.RootElement.GetProperty("error").GetProperty("recoverable").GetBoolean());
    }

    [Fact]
    public async Task Create_WithoutConfiguredFileHooksPreservesExistingApprovalBehavior()
    {
        RunTurnCommandDto command = CreateCommandWithoutApprovalRules();
        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0], ResolvedHookSet.Empty, new RecordingHookCommandRunner());

        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = "view",
            },
            null!);

        Assert.Equal("allow", decision?.PermissionDecision);
    }

    private static RunTurnCommandDto CreateCommandWithToolApproval()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            ProjectPath = @"C:\workspace\project",
            Workflow = CreateWorkflow(new ApprovalPolicyDto
            {
                Rules =
                [
                    new ApprovalCheckpointRuleDto
                    {
                        Kind = "tool-call",
                        AgentIds = ["agent-1"],
                    },
                ],
            }),
        };
    }

    private static RunTurnCommandDto CreateCommandWithoutApprovalRules()
    {
        RunTurnCommandDto command = CreateCommandWithToolApproval();
        return new RunTurnCommandDto
        {
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ProjectPath = command.ProjectPath,
            Workflow = CreateWorkflow(new ApprovalPolicyDto()),
        };
    }

    private static RunTurnCommandDto CreateCommandWithAutoApprovedCategory(string category)
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            ProjectPath = @"C:\workspace\project",
            Workflow = CreateWorkflow(new ApprovalPolicyDto
            {
                Rules =
                [
                    new ApprovalCheckpointRuleDto
                    {
                        Kind = "tool-call",
                        AgentIds = ["agent-1"],
                    },
                ],
                AutoApprovedToolNames = [category],
            }),
        };
    }

    private static RunTurnCommandDto CreateCommandWithConfiguredMcpServers(
        IReadOnlyList<string> serverNames,
        IReadOnlyList<string>? autoApprovedToolNames = null)
    {
        RunTurnCommandDto command = CreateCommandWithToolApproval();
        return new RunTurnCommandDto
        {
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ProjectPath = command.ProjectPath,
            Tooling = new RunTurnToolingConfigDto
            {
                McpServers = [.. serverNames.Select(CreateMcpServerConfig)],
            },
            Workflow = CreateWorkflow(new ApprovalPolicyDto
            {
                Rules = command.Workflow.Settings.ApprovalPolicy?.Rules ?? [],
                AutoApprovedToolNames = autoApprovedToolNames ?? [],
            }),
        };
    }

    private static WorkflowDefinitionDto CreateWorkflow(ApprovalPolicyDto approvalPolicy)
    {
        return new WorkflowDefinitionDto
        {
            Id = "workflow-1",
            Name = "Workflow",
            Graph = new WorkflowGraphDto
            {
                Nodes =
                [
                    new WorkflowNodeDto
                    {
                        Id = "agent-1",
                        Kind = "agent",
                        Label = "Primary",
                        Config = new WorkflowNodeConfigDto
                        {
                            Kind = "agent",
                            Id = "agent-1",
                            Name = "Primary",
                            Model = "gpt-5.4",
                            Instructions = "Help.",
                        },
                    },
                ],
            },
            Settings = new WorkflowSettingsDto
            {
                OrchestrationMode = "single",
                ApprovalPolicy = approvalPolicy,
            },
        };
    }

    private static RunTurnMcpServerConfigDto CreateMcpServerConfig(string serverName)
        => new()
        {
            Id = serverName,
            Name = serverName,
        };

    private static HookCommandDefinition CreateHookCommand(string name)
        => new()
        {
            Type = "command",
            Bash = name,
            PowerShell = name,
        };

    private static string GetCommandText(HookCommandDefinition hook)
        => hook.PowerShell ?? hook.Bash ?? string.Empty;

    private sealed class RecordingHookCommandRunner : IHookCommandRunner
    {
        private readonly Queue<string?> _outputs;

        public List<RecordedHookInvocation> Invocations { get; } = [];

        public RecordingHookCommandRunner(IEnumerable<string?>? outputs = null)
        {
            _outputs = outputs is null ? new Queue<string?>() : new Queue<string?>(outputs);
        }

        public Task<string?> RunAsync(
            HookCommandDefinition hook,
            string inputJson,
            string projectPath,
            CancellationToken cancellationToken)
        {
            Invocations.Add(new RecordedHookInvocation(hook, inputJson, projectPath));
            return Task.FromResult(_outputs.Count > 0 ? _outputs.Dequeue() : string.Empty);
        }
    }

    private sealed record RecordedHookInvocation(
        HookCommandDefinition Hook,
        string InputJson,
        string ProjectPath);
}

