using System.Reflection;
using System.Text.Json;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Aryx.AgentHost.Services;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotAgentBundleTests
{
    [Fact]
    public void ApplySessionTooling_MapsMcpServersAndToolsOntoTheSessionConfig()
    {
        SessionConfig sessionConfig = new()
        {
            AvailableTools = ["glob"],
        };
        Dictionary<string, object> mcpServers = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Git MCP"] = new McpLocalServerConfig
            {
                Type = "local",
                Command = "node",
                Args = ["server.js"],
                Tools = ["git.status"],
            },
        };
        AIFunction tool = CreateTool();

        CopilotAgentBundle.ApplySessionTooling(sessionConfig, mcpServers, [tool]);

        Assert.Same(mcpServers, sessionConfig.McpServers);
        Assert.NotNull(sessionConfig.Tools);
        AIFunction configuredTool = Assert.Single(sessionConfig.Tools);
        Assert.Same(tool, configuredTool);
        Assert.Equal(["glob"], sessionConfig.AvailableTools);
    }

    [Fact]
    public void ApplySessionTooling_LeavesSessionConfigUnsetWhenNoToolingIsProvided()
    {
        SessionConfig sessionConfig = new()
        {
            AvailableTools = ["glob", "view"],
        };

        CopilotAgentBundle.ApplySessionTooling(sessionConfig, null, []);

        Assert.Null(sessionConfig.McpServers);
        Assert.Null(sessionConfig.Tools);
        Assert.Equal(["glob", "view"], sessionConfig.AvailableTools);
    }

    [Fact]
    public void Constructor_StoresWhetherHooksAreConfigured()
    {
        CopilotAgentBundle bundle = new([], hasConfiguredHooks: true);

        Assert.True(bundle.HasConfiguredHooks);
        Assert.Empty(bundle.Agents);
    }

    [Fact]
    public async Task CreateConfiguredSessionConfig_MergesInstructionsAndConvertsHandoffDeclarations()
    {
        SessionConfig baseConfig = new()
        {
            Model = "gpt-5.4",
            SystemMessage = new SystemMessageConfig
            {
                Content = "Base instructions",
            },
            Tools = [CreateTool()],
        };
        ChatClientAgentRunOptions options = new(new ChatOptions
        {
            Instructions = "Workflow handoff instructions",
            Tools = [CreateHandoffDeclaration()],
        });

        SessionConfig effective = AryxCopilotAgent.CreateConfiguredSessionConfig(baseConfig, options);

        Assert.Equal("gpt-5.4", effective.Model);
        Assert.Equal("Base instructions\n\nWorkflow handoff instructions", effective.SystemMessage?.Content);
        Assert.Equal("Base instructions", baseConfig.SystemMessage?.Content);

        AIFunction[] tools = Assert.IsAssignableFrom<IEnumerable<AIFunction>>(effective.Tools).ToArray();
        Assert.Equal(2, tools.Length);
        AIFunction handoffTool = Assert.Single(tools, tool => tool.Name == "handoff_to_1");
        Assert.True(handoffTool.AdditionalProperties.TryGetValue("skip_permission", out object? skipPermission));
        Assert.Equal(true, skipPermission);

        object? result = await handoffTool.InvokeAsync(new AIFunctionArguments
        {
            ["reasonForHandoff"] = "UI specialist",
        });

        Assert.Equal("Transferred.", result?.ToString());
    }

    [Fact]
    public void CreateConfiguredSessionConfig_RejectsUnsupportedRuntimeDeclarations()
    {
        ChatClientAgentRunOptions options = new(new ChatOptions
        {
            Tools = [AIFunctionFactory.CreateDeclaration("route_elsewhere", "Unsupported declaration", CreateTool().JsonSchema)],
        });

        Assert.Throws<NotSupportedException>(() => AryxCopilotAgent.CreateConfiguredSessionConfig(new SessionConfig(), options));
    }

    [Fact]
    public void ConvertToolRequestsToFunctionCalls_MapsCallIdsNamesAndArguments()
    {
        AssistantMessageDataToolRequestsItem[] toolRequests =
        {
            new()
            {
                ToolCallId = "call-123",
                Name = "handoff_to_1",
                Arguments = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
                {
                    ["reasonForHandoff"] = "frontend specialist",
                }),
            },
        };

        FunctionCallContent functionCall = Assert.Single(AryxCopilotAgent.ConvertToolRequestsToFunctionCalls(toolRequests));

        Assert.Equal("call-123", functionCall.CallId);
        Assert.Equal("handoff_to_1", functionCall.Name);
        Assert.NotNull(functionCall.Arguments);
        Assert.Equal("frontend specialist", functionCall.Arguments["reasonForHandoff"]?.ToString());
    }

    [Fact]
    public void ConvertToolRequestsToFunctionCalls_SkipsNonHandoffToolCalls()
    {
        AssistantMessageDataToolRequestsItem[] toolRequests =
        {
            new() { ToolCallId = "call-001", Name = "ask_user" },
            new() { ToolCallId = "call-002", Name = "web_fetch" },
            new() { ToolCallId = "call-003", Name = "handoff_to_reviewer" },
            new() { ToolCallId = "call-004", Name = "grep" },
        };

        IReadOnlyList<FunctionCallContent> result = AryxCopilotAgent.ConvertToolRequestsToFunctionCalls(toolRequests);

        FunctionCallContent single = Assert.Single(result);
        Assert.Equal("call-003", single.CallId);
        Assert.Equal("handoff_to_reviewer", single.Name);
    }

    [Fact]
    public void CreateCustomAgents_MapsSdkCustomAgentConfiguration()
    {
        List<CustomAgentConfig> customAgents = Assert.IsType<List<CustomAgentConfig>>(CopilotAgentBundle.CreateCustomAgents(
        [
            new RunTurnCustomAgentConfigDto
            {
                Name = "designer",
                DisplayName = "Designer",
                Description = "Design specialist",
                Tools = ["view", "glob"],
                Prompt = "Focus on UX design.",
                Infer = true,
                McpServers =
                [
                    new RunTurnMcpServerConfigDto
                    {
                        Id = "designer-mcp",
                        Name = "Designer MCP",
                        Transport = "local",
                        Command = "node",
                        Args = ["designer.js"],
                    },
                ],
            },
        ]));

        CustomAgentConfig customAgent = Assert.Single(customAgents);
        Assert.Equal("designer", customAgent.Name);
        Assert.Equal("Designer", customAgent.DisplayName);
        Assert.Equal("Design specialist", customAgent.Description);
        Assert.Equal(["view", "glob"], customAgent.Tools);
        Assert.Equal("Focus on UX design.", customAgent.Prompt);
        Assert.True(customAgent.Infer);

        KeyValuePair<string, object> mcpServer = Assert.Single(customAgent.McpServers!);
        Assert.Equal("Designer MCP", mcpServer.Key);
        McpLocalServerConfig localServer = Assert.IsType<McpLocalServerConfig>(mcpServer.Value);
        Assert.Equal("node", localServer.Command);
        Assert.Equal(["designer.js"], localServer.Args);
    }

    [Fact]
    public void CreateInfiniteSessions_MapsSdkInfiniteSessionConfiguration()
    {
        InfiniteSessionConfig config = Assert.IsType<InfiniteSessionConfig>(CopilotAgentBundle.CreateInfiniteSessions(
            new RunTurnInfiniteSessionsConfigDto
            {
                Enabled = true,
                BackgroundCompactionThreshold = 0.75,
                BufferExhaustionThreshold = 0.9,
            }));

        Assert.True(config.Enabled);
        Assert.Equal(0.75, config.BackgroundCompactionThreshold);
        Assert.Equal(0.9, config.BufferExhaustionThreshold);
    }

    [Fact]
    public void CreateSessionConfig_DoesNotForceSessionId()
    {
        RunTurnCommandDto command = new()
        {
            SessionId = "session-1",
            ProjectPath = @"C:\workspace\project",
            WorkspaceKind = "project",
            Mode = "interactive",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-1",
                Name = "Pattern",
                Mode = "single",
                Availability = "available",
                Agents =
                [
                    new PatternAgentDefinitionDto
                    {
                        Id = "agent-1",
                        Name = "Primary",
                        Model = "gpt-5.4",
                        Instructions = "Help.",
                    },
                ],
            },
        };

        SessionConfig sessionConfig = CopilotAgentBundle.CreateSessionConfig(
            command,
            command.Pattern.Agents[0],
            agentIndex: 0);

        Assert.Null(sessionConfig.SessionId);
        Assert.Equal(@"C:\workspace\project", sessionConfig.WorkingDirectory);
        Assert.True(sessionConfig.Streaming);
        Assert.NotNull(sessionConfig.Hooks);
    }

    [Fact]
    public async Task CopilotSessionHooks_Create_UsesApprovalPolicyForPreToolUse()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-1",
                Name = "Pattern",
                Mode = "single",
                Availability = "available",
                ApprovalPolicy = new ApprovalPolicyDto
                {
                    Rules =
                    [
                        new ApprovalCheckpointRuleDto
                        {
                            Kind = "tool-call",
                            AgentIds = ["agent-1"],
                        },
                    ],
                },
                Agents =
                [
                    new PatternAgentDefinitionDto
                    {
                        Id = "agent-1",
                        Name = "Primary",
                        Model = "gpt-5.4",
                        Instructions = "Help.",
                    },
                ],
            },
        };

        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Pattern.Agents[0]);
        PreToolUseHookOutput? decision = await hooks.OnPreToolUse!(
            new PreToolUseHookInput
            {
                ToolName = "view",
            },
            null!);

        Assert.Equal("ask", decision?.PermissionDecision);
    }

    [Fact]
    public void CopilotManagedSessionIds_BuildsAndParsesStableIds()
    {
        string sessionId = CopilotManagedSessionIds.Build("session-1", "agent-ux");

        Assert.True(CopilotManagedSessionIds.TryParse(sessionId, out string aryxSessionId, out string agentId));
        Assert.Equal("session-1", aryxSessionId);
        Assert.Equal("agent-ux", agentId);
    }

    private static AIFunction CreateTool()
    {
        ToolTarget target = new();
        MethodInfo method = typeof(ToolTarget).GetMethod(nameof(ToolTarget.Echo))
            ?? throw new InvalidOperationException("Expected test method to exist.");

        return AIFunctionFactory.Create(
            method,
            target,
            new AIFunctionFactoryOptions
            {
                Name = "echo",
                Description = "Echo test tool",
            });
    }

    private static AIFunctionDeclaration CreateHandoffDeclaration()
    {
        return AIFunctionFactory.CreateDeclaration(
            "handoff_to_1",
            "Transfer ownership to a specialist",
            CreateTool().JsonSchema);
    }

    private sealed class ToolTarget
    {
        public string Echo() => "ok";
    }
}
