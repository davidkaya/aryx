using System.Reflection;
using System.Text.Json;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Aryx.AgentHost.Services;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
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
    public void ApplyPromptInvocation_RestrictsAvailableToolsAndKeepsHandoffTools()
    {
        SessionConfig sessionConfig = new()
        {
            AvailableTools = ["view", "glob", "edit"],
            Tools = [CreateTool("view"), CreateTool("edit"), CreateTool("handoff_to_reviewer")],
        };

        CopilotAgentBundle.ApplyPromptInvocation(
            sessionConfig,
            new RunTurnPromptInvocationDto
            {
                Id = "project_customization_prompt_doc_review",
                Name = "doc-review",
                SourcePath = @".github\prompts\docs\doc-review.prompt.md",
                ResolvedPrompt = "Review the docs for missing steps.",
                Tools = ["view"],
            });

        Assert.Equal(["view", "ask_user", "report_intent", "task_complete"], sessionConfig.AvailableTools);

        AIFunction[] tools = Assert.IsAssignableFrom<IEnumerable<AIFunction>>(sessionConfig.Tools).ToArray();
        Assert.Equal(2, tools.Length);
        Assert.Contains(tools, tool => tool.Name == "view");
        Assert.Contains(tools, tool => tool.Name == "handoff_to_reviewer");
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
    public void CreateHandoffWorkflowBuilder_ExplicitlyUsesHandoffOnlyFiltering()
    {
        ChatClientAgent entryAgent = CreateChatClientAgent("agent-1", "Primary");

        HandoffsWorkflowBuilder builder = CopilotAgentBundle.CreateHandoffWorkflowBuilder(entryAgent);

        FieldInfo field = typeof(HandoffsWorkflowBuilder).GetField(
            "_toolCallFilteringBehavior",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Expected HandoffsWorkflowBuilder to expose a filtering field.");

        HandoffToolCallFilteringBehavior behavior = Assert.IsType<HandoffToolCallFilteringBehavior>(field.GetValue(builder));

        Assert.Equal(HandoffToolCallFilteringBehavior.HandoffOnly, behavior);
        Assert.Equal(HandoffWorkflowGuidance.CreateWorkflowInstructions(), builder.HandoffInstructions);
    }

    [Fact]
    public void CreateHandoffWorkflowBuilder_MapsConfiguredFilteringAndInstructions()
    {
        ChatClientAgent entryAgent = CreateChatClientAgent("agent-1", "Primary");

        HandoffsWorkflowBuilder builder = CopilotAgentBundle.CreateHandoffWorkflowBuilder(
            entryAgent,
            new HandoffModeSettingsDto
            {
                ToolCallFiltering = "all",
                ReturnToPrevious = true,
                HandoffInstructions = "Use custom delegation guidance.",
            });

        FieldInfo filteringField = typeof(HandoffsWorkflowBuilder).GetField(
            "_toolCallFilteringBehavior",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Expected HandoffsWorkflowBuilder to expose a filtering field.");

        Assert.Equal(HandoffToolCallFilteringBehavior.All, filteringField.GetValue(builder));
        Assert.Equal("Use custom delegation guidance.", builder.HandoffInstructions);
    }

    [Fact]
    public void CreateHandoffWorkflow_RejectsUnknownTriageNode()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
            "handoff",
            2,
            modeSettings: new OrchestrationModeSettingsDto
            {
                Handoff = new HandoffModeSettingsDto
                {
                    TriageAgentNodeId = "missing-agent",
                },
            });

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() =>
            CopilotAgentBundle.CreateHandoffWorkflow(workflow, CreateAgents(2)));

        Assert.Contains("triage agent node", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CreateGroupChatWorkflowBuilder_UsesConfiguredRoundsNameAndDescription()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow(
            "group-chat",
            2,
            modeSettings: new OrchestrationModeSettingsDto
            {
                GroupChat = new GroupChatModeSettingsDto
                {
                    SelectionStrategy = "round-robin",
                    MaxRounds = 7,
                },
            },
            name: "Round Robin Collaboration",
            description: "Two agents iterate on a shared answer.");
        IReadOnlyList<AIAgent> agents = CreateAgents(2);

        GroupChatWorkflowBuilder builder = CopilotAgentBundle.CreateGroupChatWorkflowBuilder(workflow, agents);

        FieldInfo managerFactoryField = typeof(GroupChatWorkflowBuilder).GetField(
            "_managerFactory",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Expected GroupChatWorkflowBuilder to expose a manager factory field.");
        FieldInfo participantsField = typeof(GroupChatWorkflowBuilder).GetField(
            "_participants",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Expected GroupChatWorkflowBuilder to expose a participant field.");
        FieldInfo nameField = typeof(GroupChatWorkflowBuilder).GetField(
            "_name",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Expected GroupChatWorkflowBuilder to expose a name field.");
        FieldInfo descriptionField = typeof(GroupChatWorkflowBuilder).GetField(
            "_description",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("Expected GroupChatWorkflowBuilder to expose a description field.");

        Func<IReadOnlyList<AIAgent>, GroupChatManager> managerFactory =
            Assert.IsType<Func<IReadOnlyList<AIAgent>, GroupChatManager>>(managerFactoryField.GetValue(builder));
        RoundRobinGroupChatManager manager = Assert.IsType<RoundRobinGroupChatManager>(managerFactory(agents));
        HashSet<AIAgent> participants = Assert.IsType<HashSet<AIAgent>>(participantsField.GetValue(builder));

        Assert.Equal(7, manager.MaximumIterationCount);
        Assert.Equal(2, participants.Count);
        Assert.Equal("Round Robin Collaboration", Assert.IsType<string>(nameField.GetValue(builder)));
        Assert.Equal("Two agents iterate on a shared answer.", Assert.IsType<string>(descriptionField.GetValue(builder)));
    }

    [Fact]
    public void CreateAgentHostOptions_UsesExpectedAryxDefaults()
    {
        AIAgentHostOptions options = CopilotAgentBundle.CreateAgentHostOptions();

        Assert.Null(options.EmitAgentUpdateEvents);
        Assert.False(options.EmitAgentResponseEvents);
        Assert.False(options.InterceptUserInputRequests);
        Assert.False(options.InterceptUnterminatedFunctionCalls);
        Assert.True(options.ReassignOtherAgentsAsUsers);
        Assert.True(options.ForwardIncomingMessages);
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
    public void ConvertToolRequestsToFunctionCalls_MapsNonHandoffToolCalls()
    {
        AssistantMessageDataToolRequestsItem[] toolRequests =
        {
            new() { ToolCallId = "call-001", Name = "ask_user" },
            new() { ToolCallId = "call-002", Name = "web_fetch" },
            new() { ToolCallId = "call-003", Name = "handoff_to_reviewer" },
            new() { ToolCallId = "call-004", Name = "grep" },
        };

        IReadOnlyList<FunctionCallContent> result = AryxCopilotAgent.ConvertToolRequestsToFunctionCalls(toolRequests);

        Assert.Collection(
            result,
            functionCall =>
            {
                Assert.Equal("call-001", functionCall.CallId);
                Assert.Equal("ask_user", functionCall.Name);
            },
            functionCall =>
            {
                Assert.Equal("call-002", functionCall.CallId);
                Assert.Equal("web_fetch", functionCall.Name);
            },
            functionCall =>
            {
                Assert.Equal("call-003", functionCall.CallId);
                Assert.Equal("handoff_to_reviewer", functionCall.Name);
            },
            functionCall =>
            {
                Assert.Equal("call-004", functionCall.CallId);
                Assert.Equal("grep", functionCall.Name);
            });
    }

    [Fact]
    public void TryCreateToolResultContent_UsesSdkResultContentForNonHandoffTools()
    {
        ToolExecutionCompleteEvent toolExecutionComplete = new()
        {
            Data = new ToolExecutionCompleteData
            {
                ToolCallId = "call-123",
                Success = true,
                Result = new ToolExecutionCompleteDataResult
                {
                    Content = "Search complete.",
                    DetailedContent = "Search complete with extra context.",
                },
            },
        };

        FunctionResultContent? toolResult = AryxCopilotAgent.TryCreateToolResultContent(toolExecutionComplete, "rg");

        Assert.NotNull(toolResult);
        Assert.Equal("call-123", toolResult.CallId);
        Assert.Equal("Search complete.", Assert.IsType<string>(toolResult.Result));
        Assert.Same(toolExecutionComplete, toolResult.RawRepresentation);
    }

    [Fact]
    public void TryCreateToolResultContent_UsesSdkErrorMessageForFailedTools()
    {
        ToolExecutionCompleteEvent toolExecutionComplete = new()
        {
            Data = new ToolExecutionCompleteData
            {
                ToolCallId = "call-456",
                Success = false,
                Error = new ToolExecutionCompleteDataError
                {
                    Message = "Permission denied.",
                },
            },
        };

        FunctionResultContent? toolResult = AryxCopilotAgent.TryCreateToolResultContent(toolExecutionComplete, "view");

        Assert.NotNull(toolResult);
        Assert.Equal("call-456", toolResult.CallId);
        Assert.Equal("Permission denied.", Assert.IsType<string>(toolResult.Result));
    }

    [Fact]
    public void TryCreateToolResultContent_SkipsHandoffTools()
    {
        ToolExecutionCompleteEvent toolExecutionComplete = new()
        {
            Data = new ToolExecutionCompleteData
            {
                ToolCallId = "call-789",
                Success = true,
                Result = new ToolExecutionCompleteDataResult
                {
                    Content = "Transferred.",
                },
            },
        };

        FunctionResultContent? toolResult = AryxCopilotAgent.TryCreateToolResultContent(
            toolExecutionComplete,
            "handoff_to_reviewer");

        Assert.Null(toolResult);
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
            Workflow = CreateWorkflow("single", 1),
        };

        SessionConfig sessionConfig = CopilotAgentBundle.CreateSessionConfig(
            command,
            command.Workflow.GetAgentNodes()[0],
            agentIndex: 0);

        Assert.Null(sessionConfig.SessionId);
        Assert.Equal(@"C:\workspace\project", sessionConfig.WorkingDirectory);
        Assert.True(sessionConfig.Streaming);
        Assert.NotNull(sessionConfig.Hooks);
    }

    [Fact]
    public void CreateSessionConfig_PassesProjectInstructionsIntoTheSystemMessage()
    {
        RunTurnCommandDto command = new()
        {
            SessionId = "session-1",
            ProjectPath = @"C:\workspace\project",
            WorkspaceKind = "project",
            Mode = "interactive",
            ProjectInstructions = "Follow repository guidance.",
            Workflow = CreateWorkflow("single", 1),
        };

        SessionConfig sessionConfig = CopilotAgentBundle.CreateSessionConfig(
            command,
            command.Workflow.GetAgentNodes()[0],
            agentIndex: 0);

        Assert.Equal("Help.\n\nFollow repository guidance.", sessionConfig.SystemMessage?.Content);
    }

    [Fact]
    public void CreateSessionConfig_UsesPromptAgentOverride()
    {
        RunTurnCommandDto command = new()
        {
            SessionId = "session-1",
            ProjectPath = @"C:\workspace\project",
            WorkspaceKind = "project",
            Mode = "interactive",
            PromptInvocation = new RunTurnPromptInvocationDto
            {
                Id = "project_customization_prompt_doc_review",
                Name = "doc-review",
                SourcePath = @".github\prompts\docs\doc-review.prompt.md",
                Agent = "designer",
                ResolvedPrompt = "Review the docs for missing steps.",
            },
            Workflow = CreateWorkflow("single", 1),
        };

        SessionConfig sessionConfig = CopilotAgentBundle.CreateSessionConfig(
            command,
            command.Workflow.GetAgentNodes()[0],
            agentIndex: 0);

        Assert.Equal("designer", sessionConfig.Agent);
        Assert.Contains("Review the docs for missing steps.", sessionConfig.SystemMessage?.Content, StringComparison.Ordinal);
    }

    [Fact]
    public void CreateSessionConfig_DefaultsPromptToolInvocationsToAgentMode()
    {
        RunTurnCommandDto command = new()
        {
            SessionId = "session-1",
            ProjectPath = @"C:\workspace\project",
            WorkspaceKind = "project",
            Mode = "interactive",
            PromptInvocation = new RunTurnPromptInvocationDto
            {
                Id = "project_customization_prompt_doc_review",
                Name = "doc-review",
                SourcePath = @".github\prompts\docs\doc-review.prompt.md",
                ResolvedPrompt = "Review the docs for missing steps.",
                Tools = ["view"],
            },
            Workflow = CreateWorkflow("single", 1),
        };

        SessionConfig sessionConfig = CopilotAgentBundle.CreateSessionConfig(
            command,
            command.Workflow.GetAgentNodes()[0],
            agentIndex: 0);

        Assert.Equal("agent", sessionConfig.Agent);
    }

    [Fact]
    public async Task CopilotSessionHooks_Create_UsesApprovalPolicyForPreToolUse()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Workflow = CreateWorkflow(
                "single",
                1,
                new ApprovalPolicyDto
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

        SessionHooks hooks = CopilotSessionHooks.Create(command, command.Workflow.GetAgentNodes()[0]);
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

    private static AIFunction CreateTool(string name = "echo")
    {
        ToolTarget target = new();
        MethodInfo method = typeof(ToolTarget).GetMethod(nameof(ToolTarget.Echo))
            ?? throw new InvalidOperationException("Expected test method to exist.");

        return AIFunctionFactory.Create(
            method,
            target,
            new AIFunctionFactoryOptions
            {
                Name = name,
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

    private static IReadOnlyList<AIAgent> CreateAgents(int count)
        => Enumerable.Range(1, count)
            .Select(index => (AIAgent)CreateChatClientAgent($"agent-{index}", $"Agent {index}"))
            .ToArray();

    private static WorkflowDefinitionDto CreateWorkflow(
        string mode,
        int agentCount,
        ApprovalPolicyDto? approvalPolicy = null,
        OrchestrationModeSettingsDto? modeSettings = null,
        string? name = null,
        string? description = null)
    {
        return new WorkflowDefinitionDto
        {
            Id = $"workflow-{mode}",
            Name = name ?? $"Workflow {mode}",
            Description = description ?? string.Empty,
            Graph = new WorkflowGraphDto
            {
                Nodes =
                [
                    .. Enumerable.Range(1, agentCount).Select(index => new WorkflowNodeDto
                    {
                        Id = $"agent-{index}",
                        Kind = "agent",
                        Label = $"Agent {index}",
                        Config = new WorkflowNodeConfigDto
                        {
                            Kind = "agent",
                            Id = $"agent-{index}",
                            Name = $"Agent {index}",
                            Description = $"Agent {index} description.",
                            Instructions = "Help.",
                            Model = "gpt-5.4",
                        },
                    }),
                ],
            },
            Settings = new WorkflowSettingsDto
            {
                OrchestrationMode = mode,
                ApprovalPolicy = approvalPolicy,
                ModeSettings = modeSettings,
            },
        };
    }

    private static ChatClientAgent CreateChatClientAgent(string id, string name)
    {
        return new ChatClientAgent(
            new StubChatClient(),
            id,
            name,
            "Stub agent for handoff builder tests.",
            [],
            null!,
            null!);
    }

    private sealed class ToolTarget
    {
        public string Echo() => "ok";
    }

    private sealed class StubChatClient : IChatClient
    {
        public void Dispose()
        {
        }

        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public object? GetService(Type serviceType, object? serviceKey = null)
        {
            return null;
        }

        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }
    }
}

