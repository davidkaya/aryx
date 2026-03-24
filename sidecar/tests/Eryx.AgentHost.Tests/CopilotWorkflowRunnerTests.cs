using Eryx.AgentHost.Contracts;
using Eryx.AgentHost.Services;
using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Tests;

public sealed class CopilotWorkflowRunnerTests
{
    [Fact]
    public void SelectNewOutputMessages_SkipsFullTranscriptPrefix()
    {
        List<ChatMessage> inputMessages =
        [
            new(ChatRole.User, "Hello"),
        ];
        List<ChatMessage> outputMessages =
        [
            new(ChatRole.User, "Hello"),
            new(ChatRole.Assistant, "Hi there."),
        ];

        IReadOnlyList<ChatMessage> newMessages = WorkflowTranscriptProjector.SelectNewOutputMessages(
            outputMessages,
            inputMessages);

        ChatMessage message = Assert.Single(newMessages);
        Assert.Equal(ChatRole.Assistant, message.Role);
        Assert.Equal("Hi there.", message.Text);
    }

    [Fact]
    public void SelectNewOutputMessages_SkipsOnlyTheLatestInputOverlap()
    {
        List<ChatMessage> inputMessages =
        [
            new(ChatRole.Assistant, "Earlier answer"),
            new(ChatRole.User, "Hello"),
        ];
        List<ChatMessage> outputMessages =
        [
            new(ChatRole.User, "Hello"),
            new(ChatRole.Assistant, "Hi there."),
        ];

        IReadOnlyList<ChatMessage> newMessages = WorkflowTranscriptProjector.SelectNewOutputMessages(
            outputMessages,
            inputMessages);

        ChatMessage message = Assert.Single(newMessages);
        Assert.Equal(ChatRole.Assistant, message.Role);
        Assert.Equal("Hi there.", message.Text);
    }

    [Fact]
    public void SelectNewOutputMessages_PreservesAssistantOnlyOutput()
    {
        List<ChatMessage> inputMessages =
        [
            new(ChatRole.User, "Hello"),
        ];
        List<ChatMessage> outputMessages =
        [
            new(ChatRole.Assistant, "Hi there."),
        ];

        IReadOnlyList<ChatMessage> newMessages = WorkflowTranscriptProjector.SelectNewOutputMessages(
            outputMessages,
            inputMessages);

        ChatMessage message = Assert.Single(newMessages);
        Assert.Equal(ChatRole.Assistant, message.Role);
        Assert.Equal("Hi there.", message.Text);
    }

    [Fact]
    public void ProjectCompletedMessages_FallsBackToStreamingSegmentsWhenWorkflowOutputIsMissing()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-concurrent",
                Name = "Concurrent Brainstorm",
                Mode = "concurrent",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-concurrent-architect", name: "Architect"),
                    CreateAgent(id: "agent-concurrent-implementer", name: "Implementer"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [],
            [
                ("msg-1", "Architect", "Architecture reply"),
                ("msg-2", "Implementer", "Implementation reply"),
            ]);

        Assert.Collection(
            messages,
            architect =>
            {
                Assert.Equal("msg-1", architect.Id);
                Assert.Equal("Architect", architect.AuthorName);
                Assert.Equal("Architecture reply", architect.Content);
            },
            implementer =>
            {
                Assert.Equal("msg-2", implementer.Id);
                Assert.Equal("Implementer", implementer.AuthorName);
                Assert.Equal("Implementation reply", implementer.Content);
            });
    }

    [Fact]
    public void ProjectCompletedMessages_CanonicalizesWorkflowOutputAuthorNames()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-single",
                Name = "Single Agent",
                Mode = "single",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-single-primary", name: "Primary Agent"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Hello")
                {
                    AuthorName = "assistant",
                },
            ],
            [
                ("msg-1", "Primary Agent", "Hello"),
            ]);

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("msg-1", message.Id);
        Assert.Equal("Primary Agent", message.AuthorName);
        Assert.Equal("Hello", message.Content);
    }

    [Fact]
    public void ProjectCompletedMessages_PreservesSequentialConversationHistory()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-sequential",
                Name = "Sequential Trio Review",
                Mode = "sequential",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-sequential-analyst", name: "Analyst"),
                    CreateAgent(id: "agent-sequential-builder", name: "Builder"),
                    CreateAgent(id: "agent-sequential-reviewer", name: "Reviewer"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Plan the approach.") { AuthorName = "Analyst" },
                new ChatMessage(ChatRole.Assistant, "Implement the change.") { AuthorName = "Builder" },
                new ChatMessage(ChatRole.Assistant, "Review the implementation.") { AuthorName = "Reviewer" },
            ],
            []);

        Assert.Collection(
            messages,
            analyst =>
            {
                Assert.Equal("Analyst", analyst.AuthorName);
                Assert.Equal("Plan the approach.", analyst.Content);
            },
            builder =>
            {
                Assert.Equal("Builder", builder.AuthorName);
                Assert.Equal("Implement the change.", builder.Content);
            },
            reviewer =>
            {
                Assert.Equal("Reviewer", reviewer.AuthorName);
                Assert.Equal("Review the implementation.", reviewer.Content);
            });
    }

    [Fact]
    public void ProjectCompletedMessages_PreservesConcurrentAggregatedResponses()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-concurrent",
                Name = "Concurrent Brainstorm",
                Mode = "concurrent",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-concurrent-architect", name: "Architect"),
                    CreateAgent(id: "agent-concurrent-product", name: "Product"),
                    CreateAgent(id: "agent-concurrent-implementer", name: "Implementer"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Architecture concerns.") { AuthorName = "Architect" },
                new ChatMessage(ChatRole.Assistant, "Product trade-offs.") { AuthorName = "Product" },
                new ChatMessage(ChatRole.Assistant, "Implementation details.") { AuthorName = "Implementer" },
            ],
            []);

        Assert.Collection(
            messages,
            architect => Assert.Equal("Architect", architect.AuthorName),
            product => Assert.Equal("Product", product.AuthorName),
            implementer => Assert.Equal("Implementer", implementer.AuthorName));
    }

    [Fact]
    public void ProjectCompletedMessages_ConcurrentUsesLastStreamedMessagePerAgentForGenericOutput()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-concurrent",
                Name = "Concurrent Brainstorm",
                Mode = "concurrent",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-concurrent-architect", name: "Architect"),
                    CreateAgent(id: "agent-concurrent-product", name: "Product"),
                    CreateAgent(id: "agent-concurrent-implementer", name: "Implementer"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Architecture concerns with cleaner wording.")
                {
                    AuthorName = "assistant",
                },
                new ChatMessage(ChatRole.Assistant, "Product trade-offs with cleaned bullets.")
                {
                    AuthorName = "assistant",
                },
                new ChatMessage(ChatRole.Assistant, "Implementation details with cleaned formatting.")
                {
                    AuthorName = "assistant",
                },
            ],
            [
                ("msg-arch-1", "Architect", "Architecture concerns."),
                ("msg-prod-1", "Product", "Product trade-offs."),
                ("msg-impl-1", "Implementer", "Implementation details."),
                ("msg-arch-2", "Architect", "Architecture concerns with extra draft spacing."),
                ("msg-prod-2", "Product", "Product trade-offs with extra draft bullets."),
                ("msg-impl-2", "Implementer", "Implementation details with extra draft formatting."),
            ]);

        Assert.Collection(
            messages,
            architect =>
            {
                Assert.Equal("msg-arch-2", architect.Id);
                Assert.Equal("Architect", architect.AuthorName);
                Assert.Equal("Architecture concerns with cleaner wording.", architect.Content);
            },
            product =>
            {
                Assert.Equal("msg-prod-2", product.Id);
                Assert.Equal("Product", product.AuthorName);
                Assert.Equal("Product trade-offs with cleaned bullets.", product.Content);
            },
            implementer =>
            {
                Assert.Equal("msg-impl-2", implementer.Id);
                Assert.Equal("Implementer", implementer.AuthorName);
                Assert.Equal("Implementation details with cleaned formatting.", implementer.Content);
            });
    }

    [Fact]
    public void ProjectCompletedMessages_PreservesGroupChatConversationHistory()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-group-chat",
                Name = "Collaborative Group Chat",
                Mode = "group-chat",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-group-writer", name: "Writer"),
                    CreateAgent(id: "agent-group-reviewer", name: "Reviewer"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Initial draft.") { AuthorName = "Writer" },
                new ChatMessage(ChatRole.Assistant, "Needs clearer examples.") { AuthorName = "Reviewer" },
                new ChatMessage(ChatRole.Assistant, "Revised draft with examples.") { AuthorName = "Writer" },
            ],
            []);

        Assert.Collection(
            messages,
            writerDraft =>
            {
                Assert.Equal("Writer", writerDraft.AuthorName);
                Assert.Equal("Initial draft.", writerDraft.Content);
            },
            reviewer =>
            {
                Assert.Equal("Reviewer", reviewer.AuthorName);
                Assert.Equal("Needs clearer examples.", reviewer.Content);
            },
            writerRevision =>
            {
                Assert.Equal("Writer", writerRevision.AuthorName);
                Assert.Equal("Revised draft with examples.", writerRevision.Content);
            });
    }

    [Fact]
    public void ProjectCompletedMessages_FallsBackToPositionWhenOutputTextDiffers()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-group-chat",
                Name = "Collaborative Group Chat",
                Mode = "group-chat",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-group-writer", name: "Writer"),
                    CreateAgent(id: "agent-group-reviewer", name: "Reviewer"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Initial draft with cleaner wording.")
                {
                    AuthorName = "assistant",
                },
                new ChatMessage(ChatRole.Assistant, "Review feedback with cleaner wording.")
                {
                    AuthorName = "assistant",
                },
            ],
            [
                ("msg-1", "Writer", "Initial draft with extra draft wording."),
                ("msg-2", "Reviewer", "Review feedback with extra draft wording."),
            ]);

        Assert.Collection(
            messages,
            writer =>
            {
                Assert.Equal("msg-1", writer.Id);
                Assert.Equal("Writer", writer.AuthorName);
                Assert.Equal("Initial draft with cleaner wording.", writer.Content);
            },
            reviewer =>
            {
                Assert.Equal("msg-2", reviewer.Id);
                Assert.Equal("Reviewer", reviewer.AuthorName);
                Assert.Equal("Review feedback with cleaner wording.", reviewer.Content);
            });
    }

    [Fact]
    public void ProjectCompletedMessages_UsesFallbackAgentForGenericAssistantOutput()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-handoff",
                Name = "Handoff Support Flow",
                Mode = "handoff",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-handoff-triage", name: "Triage"),
                    CreateAgent(id: "agent-handoff-ux", name: "UX Specialist"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "The button is in place.")
                {
                    AuthorName = "assistant",
                },
            ],
            [],
            new AgentIdentity("agent-handoff-ux", "UX Specialist"));

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("UX Specialist", message.AuthorName);
        Assert.Equal("The button is in place.", message.Content);
    }

    [Fact]
    public void ProjectCompletedMessages_PrefersContentMatchedStreamingSegmentOverPosition()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-handoff",
                Name = "Handoff Support Flow",
                Mode = "handoff",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-handoff-triage", name: "Triage"),
                    CreateAgent(id: "agent-handoff-runtime", name: "Runtime Specialist"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Done — GoogleClient.cs now contains the requested class.")
                {
                    AuthorName = "assistant",
                },
            ],
            [
                ("msg-1", "Triage", "I'll hand this to a coding specialist."),
                ("msg-2", "Runtime Specialist", "Done — GoogleClient.cs now contains the requested class."),
            ],
            new AgentIdentity("agent-handoff-runtime", "Runtime Specialist"));

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("msg-2", message.Id);
        Assert.Equal("Runtime Specialist", message.AuthorName);
        Assert.Equal("Done — GoogleClient.cs now contains the requested class.", message.Content);
    }

    [Fact]
    public void ProjectCompletedMessages_UsesFallbackAgentForSingleGenericAssistantOutputWithMultipleSegments()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-handoff",
                Name = "Handoff Support Flow",
                Mode = "handoff",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-handoff-triage", name: "Triage"),
                    CreateAgent(id: "agent-handoff-runtime", name: "Runtime Specialist"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Done — GoogleClient.cs now contains the requested class with cleaned formatting.")
                {
                    AuthorName = "assistant",
                },
            ],
            [
                ("msg-1", "Triage", "I'll hand this to a coding specialist."),
                ("msg-2", "Runtime Specialist", "Done — GoogleClient.cs now contains the requested class with draft formatting."),
            ],
            new AgentIdentity("agent-handoff-runtime", "Runtime Specialist"));

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("msg-2", message.Id);
        Assert.Equal("Runtime Specialist", message.AuthorName);
        Assert.Equal("Done — GoogleClient.cs now contains the requested class with cleaned formatting.", message.Content);
    }

    [Fact]
    public void ProjectCompletedMessages_DropsBlankAssistantOutputMessages()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-handoff",
                Name = "Handoff Support Flow",
                Mode = "handoff",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-handoff-triage", name: "Triage"),
                    CreateAgent(id: "agent-handoff-ux", name: "UX Specialist"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, string.Empty)
                {
                    AuthorName = "assistant",
                },
                new ChatMessage(ChatRole.Assistant, "Real content")
                {
                    AuthorName = "assistant",
                },
            ],
            [],
            new AgentIdentity("agent-handoff-ux", "UX Specialist"));

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("UX Specialist", message.AuthorName);
        Assert.Equal("Real content", message.Content);
    }

    [Fact]
    public void StreamingTranscriptBuffer_MergesUpdatesPerMessageId()
    {
        StreamingTranscriptBuffer buffer = new();

        buffer.AppendDelta("msg-1", "Architect", "Hello");
        (string messageId, string authorName, string content) = buffer.AppendDelta("msg-1", "Architect", " world");

        Assert.Equal("msg-1", messageId);
        Assert.Equal("Architect", authorName);
        Assert.Equal("Hello world", content);
        Assert.Collection(
            buffer.Snapshot(),
            segment =>
            {
                Assert.Equal("msg-1", segment.MessageId);
                Assert.Equal("Architect", segment.AuthorName);
                Assert.Equal("Hello world", segment.Content);
            });
    }

    [Fact]
    public void StreamingTranscriptBuffer_PreservesInsertionOrderAcrossMessages()
    {
        StreamingTranscriptBuffer buffer = new();

        buffer.AppendDelta("msg-1", "Architect", "A");
        buffer.AppendDelta("msg-2", "Implementer", "B");
        buffer.AppendDelta("msg-1", "Architect", " plus");

        Assert.Collection(
            buffer.Snapshot(),
            first =>
            {
                Assert.Equal("msg-1", first.MessageId);
                Assert.Equal("Architect", first.AuthorName);
                Assert.Equal("A plus", first.Content);
            },
            second =>
             {
                 Assert.Equal("msg-2", second.MessageId);
                 Assert.Equal("Implementer", second.AuthorName);
                 Assert.Equal("B", second.Content);
             });
    }

    [Fact]
    public void ObserveSessionEvent_TracksObservedAgentByMessageId()
    {
        CopilotTurnExecutionState state = new(CreateHandoffCommand());
        SessionEvent sessionEvent = SessionEvent.FromJson(
            """
            {
              "type": "assistant.message_delta",
              "data": {
                "messageId": "msg-7",
                "deltaContent": "Done."
              },
              "id": "11111111-1111-1111-1111-111111111111",
              "timestamp": "2026-03-24T00:00:00Z"
            }
            """);

        state.ObserveSessionEvent(CreateAgent("agent-handoff-ux", "UX Specialist"), sessionEvent);

        Assert.True(state.TryResolveObservedAgentForMessage("msg-7", out AgentIdentity observedAgent));
        Assert.Equal("agent-handoff-ux", observedAgent.AgentId);
        Assert.Equal("UX Specialist", observedAgent.AgentName);
        Assert.Equal("agent-handoff-ux", state.ActiveAgent?.AgentId);
    }

    [Fact]
    public void ObserveSessionEvent_UsesReasoningDeltasToTrackActiveAgent()
    {
        CopilotTurnExecutionState state = new(CreateHandoffCommand());
        SessionEvent sessionEvent = SessionEvent.FromJson(
            """
            {
              "type": "assistant.reasoning_delta",
              "data": {
                "reasoningId": "reasoning-1",
                "deltaContent": "Planning."
              },
              "id": "22222222-2222-2222-2222-222222222222",
              "timestamp": "2026-03-24T00:00:00Z"
            }
            """);

        state.ObserveSessionEvent(CreateAgent("agent-handoff-ux", "UX Specialist"), sessionEvent);

        Assert.Equal("agent-handoff-ux", state.ActiveAgent?.AgentId);
        Assert.Equal("UX Specialist", state.ActiveAgent?.AgentName);
    }

    [Fact]
    public void RequiresToolCallApproval_HonorsAutoApprovedToolNames()
    {
        ApprovalPolicyDto policy = new()
        {
            Rules =
            [
                new ApprovalCheckpointRuleDto
                {
                    Kind = "tool-call",
                    AgentIds = ["agent-1"],
                },
            ],
            AutoApprovedToolNames = ["lsp_ts_hover", "web_fetch"],
        };

        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-1", "lsp_ts_hover"));
        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-1", "web_fetch"));
        Assert.True(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-1", "lsp_ts_definition"));
        Assert.True(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-1", null));
        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-2", "lsp_ts_definition"));
    }

    [Fact]
    public void TryGetApprovalToolName_ReadsMcpCustomAndHookRequests()
    {
        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestMcp
                {
                    Kind = "mcp",
                    ServerName = "Git MCP",
                    ToolName = "git.status",
                    ToolTitle = "Git Status",
                    ReadOnly = true,
                },
                out string? mcpToolName));
        Assert.Equal("git.status", mcpToolName);

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestCustomTool
                {
                    Kind = "custom tool",
                    ToolName = "lsp_ts_hover",
                    ToolDescription = "Hover information",
                },
                out string? customToolName));
        Assert.Equal("lsp_ts_hover", customToolName);

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestHook
                {
                    Kind = "hook",
                    ToolName = "web_fetch",
                    ToolArgs = """{"url":"https://example.com"}""",
                    HookMessage = "Review required before fetch",
                },
                out string? hookToolName));
        Assert.Equal("web_fetch", hookToolName);

        Assert.False(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestShell
                {
                    Kind = "shell",
                    FullCommandText = "git status",
                    Intention = "Inspect repository state",
                    Commands = [],
                    PossiblePaths = [],
                    PossibleUrls = [],
                    HasWriteFileRedirection = false,
                    CanOfferSessionApproval = false,
                },
                out string? shellToolName));
        Assert.Null(shellToolName);
    }

    [Fact]
    public void TryGetApprovalToolName_UsesToolCallLookupForPermissionCategoriesWithoutDirectToolNames()
    {
        Dictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal)
        {
            ["tool-call-url"] = "web_fetch",
            ["tool-call-shell"] = "shell",
            ["tool-call-read"] = "view",
        };

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestUrl
                {
                    Kind = "url",
                    ToolCallId = "tool-call-url",
                    Intention = "Fetch the requested page",
                    Url = "https://example.com/docs",
                },
                toolNamesByCallId,
                out string? urlToolName));
        Assert.Equal("web_fetch", urlToolName);

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestShell
                {
                    Kind = "shell",
                    ToolCallId = "tool-call-shell",
                    FullCommandText = "curl https://example.com/docs",
                    Intention = "Fetch documentation with curl",
                    Commands = [],
                    PossiblePaths = [],
                    PossibleUrls = [],
                    HasWriteFileRedirection = false,
                    CanOfferSessionApproval = false,
                },
                toolNamesByCallId,
                out string? shellToolName));
        Assert.Equal("shell", shellToolName);

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestRead
                {
                    Kind = "read",
                    ToolCallId = "tool-call-read",
                    Intention = "Inspect a file",
                    Path = "README.md",
                },
                toolNamesByCallId,
                out string? readToolName));
        Assert.Equal("view", readToolName);
    }

    [Fact]
    public void TryGetApprovalToolName_FallsBackToWebFetchForUncorrelatedUrlRequests()
    {
        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestUrl
                {
                    Kind = "url",
                    ToolCallId = "tool-call-1",
                    Intention = "Fetch the requested page",
                    Url = "https://example.com/docs",
                },
                out string? urlToolName));
        Assert.Equal("web_fetch", urlToolName);
    }

    [Fact]
    public void BuildPermissionApprovalEvent_IncludesToolContextWhenKnown()
    {
        ApprovalRequestedEventDto approvalEvent = CopilotApprovalCoordinator.BuildPermissionApprovalEvent(
            new RunTurnCommandDto
            {
                RequestId = "turn-1",
                SessionId = "session-1",
            },
            CreateAgent("agent-1", "Primary"),
            new PermissionRequestCustomTool
            {
                Kind = "custom tool",
                ToolName = "lsp_ts_hover",
                ToolDescription = "Hover information",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            "approval-1",
            "lsp_ts_hover");

        Assert.Equal("lsp_ts_hover", approvalEvent.ToolName);
        Assert.Equal("Approve lsp_ts_hover", approvalEvent.Title);
        Assert.Contains("tool \"lsp_ts_hover\"", approvalEvent.Detail);
    }

    [Fact]
    public void BuildPermissionApprovalEvent_IncludesRequestedUrlForUrlPermissions()
    {
        ApprovalRequestedEventDto approvalEvent = CopilotApprovalCoordinator.BuildPermissionApprovalEvent(
            new RunTurnCommandDto
            {
                RequestId = "turn-1",
                SessionId = "session-1",
            },
            CreateAgent("agent-1", "Analyst"),
            new PermissionRequestUrl
            {
                Kind = "url",
                ToolCallId = "tool-call-1",
                Intention = "Fetch the requested page",
                Url = "https://example.com/docs",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            "approval-1",
            "web_fetch");

        Assert.Equal("web_fetch", approvalEvent.ToolName);
        Assert.Equal("Approve web_fetch", approvalEvent.Title);
        Assert.Contains("url permission", approvalEvent.Detail);
        Assert.Contains("tool \"web_fetch\"", approvalEvent.Detail);
        Assert.Contains("https://example.com/docs", approvalEvent.Detail);
    }

    [Fact]
    public async Task RequestApprovalAsync_RaisesApprovalAndCompletesAfterResolution()
    {
        CopilotApprovalCoordinator coordinator = new();
        ApprovalRequestedEventDto? observedApproval = null;
        RunTurnCommandDto command = CreateApprovalCommand();

        Task<PermissionRequestResult> pending = coordinator.RequestApprovalAsync(
            command,
            command.Pattern.Agents[0],
            new PermissionRequestCustomTool
            {
                Kind = "custom tool",
                ToolName = "lsp_ts_definition",
                ToolDescription = "Go to definition",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            new Dictionary<string, string>(StringComparer.Ordinal),
            approval =>
            {
                observedApproval = approval;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.False(pending.IsCompleted);
        Assert.NotNull(observedApproval);

        await coordinator.ResolveApprovalAsync(
            new ResolveApprovalCommandDto
            {
                ApprovalId = observedApproval!.ApprovalId,
                Decision = "approved",
            },
            CancellationToken.None);

        PermissionRequestResult result = await pending;
        Assert.Equal(PermissionRequestResultKind.Approved, result.Kind);
    }

    [Fact]
    public async Task RequestApprovalAsync_AutoApprovesToolsThatDoNotRequireApproval()
    {
        CopilotApprovalCoordinator coordinator = new();
        bool sawApproval = false;
        RunTurnCommandDto command = CreateApprovalCommand();

        PermissionRequestResult result = await coordinator.RequestApprovalAsync(
            command,
            command.Pattern.Agents[0],
            new PermissionRequestCustomTool
            {
                Kind = "custom tool",
                ToolName = "web_fetch",
                ToolDescription = "Fetch documentation",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            new Dictionary<string, string>(StringComparer.Ordinal),
            approval =>
            {
                sawApproval = true;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.False(sawApproval);
        Assert.Equal(PermissionRequestResultKind.Approved, result.Kind);
    }

    [Fact]
    public async Task ResolveApprovalAsync_RejectsUnknownApprovalIds()
    {
        CopilotApprovalCoordinator coordinator = new();

        InvalidOperationException error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            coordinator.ResolveApprovalAsync(
                new ResolveApprovalCommandDto
                {
                    ApprovalId = "approval-missing",
                    Decision = "approved",
                },
                CancellationToken.None));

        Assert.Contains("is not pending", error.Message);
    }

    private static PatternAgentDefinitionDto CreateAgent(string id, string name)
    {
        return new PatternAgentDefinitionDto
        {
            Id = id,
            Name = name,
            Model = "gpt-5.4",
            Instructions = "Help with the request.",
        };
    }

    private static RunTurnCommandDto CreateHandoffCommand()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-handoff",
                Name = "Handoff Flow",
                Mode = "handoff",
                Availability = "available",
                Agents =
                [
                    CreateAgent("agent-handoff-triage", "Triage"),
                    CreateAgent("agent-handoff-ux", "UX Specialist"),
                ],
            },
        };
    }

    private static RunTurnCommandDto CreateApprovalCommand()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-1",
                Name = "Approval Pattern",
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
                    AutoApprovedToolNames = ["web_fetch"],
                },
                Agents =
                [
                    CreateAgent("agent-1", "Primary"),
                ],
            },
        };
    }
}
