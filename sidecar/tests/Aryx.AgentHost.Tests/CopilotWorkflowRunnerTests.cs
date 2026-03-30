using System.Reflection;
using System.Runtime.CompilerServices;
using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotWorkflowRunnerTests
{
    [Fact]
    public void ConfigureHookLifecycleEventSuppression_SetsStateFromBundle()
    {
        RunTurnCommandDto command = CreateApprovalCommand();
        CopilotTurnExecutionState state = new(command);
        CopilotAgentBundle bundle = new(Array.Empty<AIAgent>(), hasConfiguredHooks: false);

        CopilotWorkflowRunner.ConfigureHookLifecycleEventSuppression(state, bundle);

        Assert.True(state.SuppressHookLifecycleEvents);
    }

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
    public void ProjectCompletedMessages_UsesFinalAssistantPayloadWhenStreamingTextIsMissing()
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
                new ChatMessage(ChatRole.Assistant, string.Empty)
                {
                    MessageId = "msg-1",
                    RawRepresentation = new AssistantMessageEvent
                    {
                        Data = new AssistantMessageData
                        {
                            MessageId = "msg-1",
                            Content = "Hello from the final assistant payload.",
                        },
                    },
                },
            ],
            []);

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("msg-1", message.Id);
        Assert.Equal("Primary Agent", message.AuthorName);
        Assert.Equal("Hello from the final assistant payload.", message.Content);
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
        AgentActivityEventDto activity = Assert.Single(state.DrainPendingEvents().OfType<AgentActivityEventDto>());
        Assert.Equal("thinking", activity.ActivityType);
        Assert.Equal("agent-handoff-ux", activity.AgentId);
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
        AgentActivityEventDto activity = Assert.Single(state.DrainPendingEvents().OfType<AgentActivityEventDto>());
        Assert.Equal("thinking", activity.ActivityType);
        Assert.Equal("agent-handoff-ux", activity.AgentId);
    }

    [Fact]
    public async Task HandleWorkflowEventAsync_EmitsThinkingForHandoffTargets()
    {
        RunTurnCommandDto command = CreateHandoffCommand();
        CopilotTurnExecutionState state = new(command);
        state.ObserveSessionEvent(
            CreateAgent("agent-handoff-triage", "Triage"),
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.reasoning_delta",
                  "data": {
                    "reasoningId": "reasoning-1",
                    "deltaContent": "Delegating."
                  },
                  "id": "33333333-3333-3333-3333-333333333333",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));
        _ = state.DrainPendingEvents();
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            CreateHandoffTarget("agent-handoff-ux", "UX Specialist"));
        List<AgentActivityEventDto> activities = [];

        MethodInfo handleWorkflowEvent = typeof(CopilotWorkflowRunner).GetMethod(
            "HandleWorkflowEventAsync",
            BindingFlags.NonPublic | BindingFlags.Static)!;
        Task<bool> handleTask = (Task<bool>)handleWorkflowEvent.Invoke(
            null,
            [
                command,
                requestInfo,
                Array.Empty<ChatMessage>(),
                state,
                (Func<TurnDeltaEventDto, Task>)(_ => Task.CompletedTask),
                (Func<SidecarEventDto, Task>)(sidecarEvent =>
                {
                    activities.Add(Assert.IsType<AgentActivityEventDto>(sidecarEvent));
                    return Task.CompletedTask;
                }),
            ])!;

        bool shouldEndTurn = await handleTask;

        Assert.False(shouldEndTurn);
        Assert.Collection(
            activities,
            handoff =>
            {
                Assert.Equal("handoff", handoff.ActivityType);
                Assert.Equal("agent-handoff-ux", handoff.AgentId);
                Assert.Equal("UX Specialist", handoff.AgentName);
                Assert.Equal("agent-handoff-triage", handoff.SourceAgentId);
            },
            thinking =>
            {
                Assert.Equal("thinking", thinking.ActivityType);
                Assert.Equal("agent-handoff-ux", thinking.AgentId);
                Assert.Equal("UX Specialist", thinking.AgentName);
            });
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
    public void RequiresToolCallApproval_HonorsRuntimeApprovalAliases()
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
            AutoApprovedToolNames = ["read", "store_memory"],
        };

        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-1", "view", "read"));
        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-1", "remember_fact", "store_memory"));
        Assert.True(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-1", "write_file", "write"));
        Assert.True(CopilotApprovalCoordinator.RequiresToolCallApproval(policy, "agent-1", "git.status"));
    }

    [Fact]
    public void RequiresToolCallApproval_HonorsMcpServerLevelApprovalKey()
    {
        ApprovalPolicyDto policy = new()
        {
            Rules =
            [
                new ApprovalCheckpointRuleDto
                {
                    Kind = "tool-call",
                },
            ],
            AutoApprovedToolNames = ["mcp_server:Git MCP"],
        };

        // Server-level key approves any tool from that server
        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(
            policy, "agent-1", "git.status", null, "mcp_server:Git MCP"));
        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(
            policy, "agent-1", "git.diff", null, "mcp_server:Git MCP"));

        // Different server still requires approval
        Assert.True(CopilotApprovalCoordinator.RequiresToolCallApproval(
            policy, "agent-1", "fs.read", null, "mcp_server:Filesystem"));

        // Non-MCP tools unaffected
        Assert.True(CopilotApprovalCoordinator.RequiresToolCallApproval(
            policy, "agent-1", "unknown_tool"));
    }

    [Fact]
    public void TryGetApprovalToolName_ResolvesDirectNamesAndRuntimeFallbacks()
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

        Assert.True(
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
        Assert.Equal("shell", shellToolName);
    }

    [Fact]
    public void TryGetApprovalToolName_FallsBackToRuntimeApprovalAliasesWhenLookupMissing()
    {
        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestRead
                {
                    Kind = "read",
                    ToolCallId = "tool-call-read",
                    Intention = "Inspect a file",
                    Path = "README.md",
                },
                out string? readToolName));
        Assert.Equal("read", readToolName);

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestWrite
                {
                    Kind = "write",
                    ToolCallId = "tool-call-write",
                    Intention = "Update a file",
                    FileName = "README.md",
                    Diff = "@@ -1 +1 @@",
                },
                out string? writeToolName));
        Assert.Equal("write", writeToolName);

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestMemory
                {
                    Kind = "memory",
                    ToolCallId = "tool-call-memory",
                    Subject = "repo conventions",
                    Fact = "Use Bun for script execution.",
                    Citations = "package.json",
                },
                out string? memoryToolName));
        Assert.Equal("store_memory", memoryToolName);
    }

    [Fact]
    public void TryGetApprovalToolName_UsesToolCallLookupForPermissionCategoriesWithoutDirectToolNames()
    {
        Dictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal)
        {
            ["tool-call-url"] = "web_fetch",
            ["tool-call-shell"] = "shell",
            ["tool-call-read"] = "view",
            ["tool-call-write"] = "write_file",
            ["tool-call-memory"] = "store_memory",
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

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestWrite
                {
                    Kind = "write",
                    ToolCallId = "tool-call-write",
                    Intention = "Update a file",
                    FileName = "README.md",
                    Diff = "@@ -1 +1 @@",
                },
                toolNamesByCallId,
                out string? writeToolName));
        Assert.Equal("write_file", writeToolName);

        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestMemory
                {
                    Kind = "memory",
                    ToolCallId = "tool-call-memory",
                    Subject = "repo conventions",
                    Fact = "Use Bun for script execution.",
                    Citations = "package.json",
                },
                toolNamesByCallId,
                out string? memoryToolName));
        Assert.Equal("store_memory", memoryToolName);
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
        Assert.NotNull(approvalEvent.PermissionDetail);
        Assert.Equal("custom-tool", approvalEvent.PermissionDetail!.Kind);
        Assert.Equal("Hover information", approvalEvent.PermissionDetail.ToolDescription);
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
        Assert.NotNull(approvalEvent.PermissionDetail);
        Assert.Equal("url", approvalEvent.PermissionDetail!.Kind);
        Assert.Equal("Fetch the requested page", approvalEvent.PermissionDetail.Intention);
        Assert.Equal("https://example.com/docs", approvalEvent.PermissionDetail.Url);
    }

    [Fact]
    public void BuildPermissionDetail_ExtractsShellRequestData()
    {
        PermissionDetailDto detail = CopilotApprovalCoordinator.BuildPermissionDetail(
            new PermissionRequestShell
            {
                Kind = "shell",
                ToolCallId = "tool-call-shell",
                FullCommandText = "curl https://example.com/docs > docs.json",
                Intention = "Fetch documentation with curl",
                Commands =
                [
                    new PermissionRequestShellCommandsItem
                    {
                        Identifier = "curl",
                        ReadOnly = true,
                    },
                ],
                PossiblePaths = ["docs.json"],
                PossibleUrls =
                [
                    new PermissionRequestShellPossibleUrlsItem
                    {
                        Url = "https://example.com/docs",
                    },
                ],
                HasWriteFileRedirection = true,
                CanOfferSessionApproval = false,
                Warning = "Downloads remote content and writes it to disk.",
            });

        Assert.Equal("shell", detail.Kind);
        Assert.Equal("curl https://example.com/docs > docs.json", detail.Command);
        Assert.Equal("Fetch documentation with curl", detail.Intention);
        Assert.Equal("Downloads remote content and writes it to disk.", detail.Warning);
        Assert.Equal(["docs.json"], detail.PossiblePaths);
        Assert.Equal(["https://example.com/docs"], detail.PossibleUrls);
        Assert.True(detail.HasWriteFileRedirection);
    }

    [Fact]
    public void BuildPermissionDetail_ExtractsWriteRequestData()
    {
        PermissionDetailDto detail = CopilotApprovalCoordinator.BuildPermissionDetail(
            new PermissionRequestWrite
            {
                Kind = "write",
                ToolCallId = "tool-call-write",
                Intention = "Update README guidance",
                FileName = "README.md",
                Diff = "@@ -1 +1 @@\n-Hello\n+Hello world",
                NewFileContents = "# README",
            });

        Assert.Equal("write", detail.Kind);
        Assert.Equal("Update README guidance", detail.Intention);
        Assert.Equal("README.md", detail.FileName);
        Assert.Equal("@@ -1 +1 @@\n-Hello\n+Hello world", detail.Diff);
        Assert.Equal("# README", detail.NewFileContents);
    }

    [Fact]
    public void BuildPermissionDetail_ExtractsReadRequestData()
    {
        PermissionDetailDto detail = CopilotApprovalCoordinator.BuildPermissionDetail(
            new PermissionRequestRead
            {
                Kind = "read",
                ToolCallId = "tool-call-read",
                Intention = "Inspect the README",
                Path = "README.md",
            });

        Assert.Equal("read", detail.Kind);
        Assert.Equal("Inspect the README", detail.Intention);
        Assert.Equal("README.md", detail.Path);
    }

    [Fact]
    public void BuildPermissionDetail_ExtractsMcpRequestData()
    {
        PermissionDetailDto detail = CopilotApprovalCoordinator.BuildPermissionDetail(
            new PermissionRequestMcp
            {
                Kind = "mcp",
                ToolCallId = "tool-call-mcp",
                ServerName = "Git MCP",
                ToolName = "git.status",
                ToolTitle = "Git Status",
                Args = new Dictionary<string, object?>
                {
                    ["path"] = ".",
                },
                ReadOnly = true,
            });

        Assert.Equal("mcp", detail.Kind);
        Assert.Equal("Git MCP", detail.ServerName);
        Assert.Equal("Git Status", detail.ToolTitle);
        Assert.True(detail.ReadOnly);

        Dictionary<string, object?> args = Assert.IsType<Dictionary<string, object?>>(detail.Args);
        Assert.Equal(".", args["path"]);
    }

    [Fact]
    public void BuildPermissionDetail_ExtractsUrlRequestData()
    {
        PermissionDetailDto detail = CopilotApprovalCoordinator.BuildPermissionDetail(
            new PermissionRequestUrl
            {
                Kind = "url",
                ToolCallId = "tool-call-url",
                Intention = "Fetch the requested page",
                Url = "https://example.com/docs",
            });

        Assert.Equal("url", detail.Kind);
        Assert.Equal("Fetch the requested page", detail.Intention);
        Assert.Equal("https://example.com/docs", detail.Url);
    }

    [Fact]
    public void BuildPermissionDetail_ExtractsMemoryRequestData()
    {
        PermissionDetailDto detail = CopilotApprovalCoordinator.BuildPermissionDetail(
            new PermissionRequestMemory
            {
                Kind = "memory",
                ToolCallId = "tool-call-memory",
                Subject = "repo conventions",
                Fact = "Use Bun for script execution.",
                Citations = "package.json",
            });

        Assert.Equal("memory", detail.Kind);
        Assert.Equal("repo conventions", detail.Subject);
        Assert.Equal("Use Bun for script execution.", detail.Fact);
        Assert.Equal("package.json", detail.Citations);
    }

    [Fact]
    public void BuildPermissionDetail_ExtractsCustomToolRequestData()
    {
        PermissionDetailDto detail = CopilotApprovalCoordinator.BuildPermissionDetail(
            new PermissionRequestCustomTool
            {
                Kind = "custom tool",
                ToolName = "lsp_ts_hover",
                ToolDescription = "Hover information",
                Args = new Dictionary<string, object?>
                {
                    ["file"] = "src/index.ts",
                    ["line"] = 12,
                },
            });

        Assert.Equal("custom-tool", detail.Kind);
        Assert.Equal("Hover information", detail.ToolDescription);

        Dictionary<string, object?> args = Assert.IsType<Dictionary<string, object?>>(detail.Args);
        Assert.Equal("src/index.ts", args["file"]);
        Assert.Equal(12, args["line"]);
    }

    [Fact]
    public void BuildPermissionDetail_ExtractsHookRequestData()
    {
        PermissionDetailDto detail = CopilotApprovalCoordinator.BuildPermissionDetail(
            new PermissionRequestHook
            {
                Kind = "hook",
                ToolName = "web_fetch",
                ToolArgs = new Dictionary<string, object?>
                {
                    ["url"] = "https://example.com",
                },
                HookMessage = "Review required before fetch",
            });

        Assert.Equal("hook", detail.Kind);
        Assert.Equal("Review required before fetch", detail.HookMessage);

        Dictionary<string, object?> args = Assert.IsType<Dictionary<string, object?>>(detail.Args);
        Assert.Equal("https://example.com", args["url"]);
    }

    [Theory]
    [InlineData("view", "read")]
    [InlineData("glob", "read")]
    [InlineData("grep", "read")]
    [InlineData("lsp", "read")]
    [InlineData("edit", "write")]
    [InlineData("create", "write")]
    [InlineData("powershell", "shell")]
    [InlineData("read_powershell", "shell")]
    [InlineData("write_powershell", "shell")]
    [InlineData("stop_powershell", "shell")]
    [InlineData("list_powershell", "shell")]
    [InlineData("web_fetch", "url")]
    [InlineData("web_search", "url")]
    [InlineData("store_memory", "memory")]
    public void ResolveHookToolCategory_ReturnsExpectedCategoryForKnownTools(string toolName, string expectedCategory)
    {
        Assert.Equal(expectedCategory, CopilotApprovalCoordinator.ResolveHookToolCategory(toolName));
    }

    [Theory]
    [InlineData("icm-mcp-get_on_call_schedule")]
    [InlineData("custom_tool")]
    [InlineData("unknown")]
    public void ResolveHookToolCategory_ReturnsNullForUnknownTools(string toolName)
    {
        Assert.Null(CopilotApprovalCoordinator.ResolveHookToolCategory(toolName));
    }

    [Fact]
    public void ResolveHookToolCategory_ReturnsNullForNullOrEmpty()
    {
        Assert.Null(CopilotApprovalCoordinator.ResolveHookToolCategory(null));
        Assert.Null(CopilotApprovalCoordinator.ResolveHookToolCategory(""));
        Assert.Null(CopilotApprovalCoordinator.ResolveHookToolCategory("  "));
    }

    [Fact]
    public void TryGetApprovalToolName_ResolvesHookToolToCategory()
    {
        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                new PermissionRequestHook
                {
                    Kind = "hook",
                    ToolName = "view",
                    ToolArgs = """{"path":"README.md"}""",
                },
                out string? toolName));
        Assert.Equal("view", toolName);

        // But the auto-approved name (fallback) resolves to the category
        PermissionRequestHook hookRequest = new()
        {
            Kind = "hook",
            ToolName = "view",
            ToolArgs = """{"path":"README.md"}""",
        };

        // Verify GetFallbackToolName returns category via ResolveAutoApprovedToolName path
        Assert.True(
            CopilotApprovalCoordinator.TryGetApprovalToolName(
                hookRequest,
                out _));
    }

    [Fact]
    public void RequiresToolCallApproval_HonorsHookToolCategoryForAutoApproval()
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
            AutoApprovedToolNames = ["read"],
        };

        // "view" is a hook tool that maps to "read" category — should be auto-approved
        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(
            policy, "agent-1", "view", "read"));

        // "grep" also maps to "read"
        Assert.False(CopilotApprovalCoordinator.RequiresToolCallApproval(
            policy, "agent-1", "grep", "read"));

        // "edit" maps to "write" — not auto-approved
        Assert.True(CopilotApprovalCoordinator.RequiresToolCallApproval(
            policy, "agent-1", "edit", "write"));
    }

    [Fact]
    public void BuildPermissionApprovalEvent_UsesResolvedCategoryForHookPermissionKind()
    {
        ApprovalRequestedEventDto approvalEvent = CopilotApprovalCoordinator.BuildPermissionApprovalEvent(
            new RunTurnCommandDto
            {
                RequestId = "turn-1",
                SessionId = "session-1",
            },
            CreateAgent("agent-1", "Primary"),
            new PermissionRequestHook
            {
                Kind = "hook",
                ToolName = "view",
                ToolArgs = """{"path":"README.md"}""",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            "approval-1",
            "view");

        Assert.Equal("view", approvalEvent.ToolName);
        Assert.Equal("read", approvalEvent.PermissionKind);
        Assert.Contains("read permission", approvalEvent.Detail);
    }

    [Fact]
    public void BuildPermissionApprovalEvent_KeepsHookKindForUnknownHookTools()
    {
        ApprovalRequestedEventDto approvalEvent = CopilotApprovalCoordinator.BuildPermissionApprovalEvent(
            new RunTurnCommandDto
            {
                RequestId = "turn-1",
                SessionId = "session-1",
            },
            CreateAgent("agent-1", "Primary"),
            new PermissionRequestHook
            {
                Kind = "hook",
                ToolName = "icm-mcp-get_schedule",
                ToolArgs = """{"teamIds":[91982]}""",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            "approval-1",
            "icm-mcp-get_schedule");

        Assert.Equal("hook", approvalEvent.PermissionKind);
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
    public async Task RequestApprovalAsync_EmitsFileChangeActivityForWriteRequests()
    {
        CopilotApprovalCoordinator coordinator = new();
        AgentActivityEventDto? observedActivity = null;
        ApprovalRequestedEventDto? observedApproval = null;
        RunTurnCommandDto command = CreateApprovalCommand();

        Task<PermissionRequestResult> pending = coordinator.RequestApprovalAsync(
            command,
            command.Pattern.Agents[0],
            new PermissionRequestWrite
            {
                Kind = "write",
                ToolCallId = "tool-call-write-1",
                Intention = "Update the README",
                FileName = "README.md",
                Diff = "@@ -1 +1 @@",
                NewFileContents = "# Aryx\n",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["tool-call-write-1"] = "apply_patch",
            },
            activity =>
            {
                observedActivity = activity;
                return Task.CompletedTask;
            },
            approval =>
            {
                observedApproval = approval;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.False(pending.IsCompleted);
        Assert.NotNull(observedActivity);
        Assert.NotNull(observedApproval);
        Assert.Equal("tool-calling", observedActivity!.ActivityType);
        Assert.Equal("apply_patch", observedActivity.ToolName);
        Assert.Equal("tool-call-write-1", observedActivity.ToolCallId);

        ToolCallFileChangeDto preview = Assert.Single(observedActivity.FileChanges!);
        Assert.Equal("README.md", preview.Path);
        Assert.Equal("@@ -1 +1 @@", preview.Diff);
        Assert.Equal("# Aryx\n", preview.NewFileContents);

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
    public async Task RequestApprovalAsync_AlwaysApproveCachesRuntimeApprovalForCurrentTurn()
    {
        CopilotApprovalCoordinator coordinator = new();
        ApprovalRequestedEventDto? firstApproval = null;
        RunTurnCommandDto command = CreateApprovalCommand();

        Task<PermissionRequestResult> firstPending = coordinator.RequestApprovalAsync(
            command,
            command.Pattern.Agents[0],
            new PermissionRequestRead
            {
                Kind = "read",
                ToolCallId = "tool-call-read-1",
                Intention = "Inspect README guidance",
                Path = "README.md",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["tool-call-read-1"] = "view",
            },
            approval =>
            {
                firstApproval = approval;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.False(firstPending.IsCompleted);
        Assert.NotNull(firstApproval);

        await coordinator.ResolveApprovalAsync(
            new ResolveApprovalCommandDto
            {
                ApprovalId = firstApproval!.ApprovalId,
                Decision = "approved",
                AlwaysApprove = true,
            },
            CancellationToken.None);

        PermissionRequestResult firstResult = await firstPending;
        Assert.Equal(PermissionRequestResultKind.Approved, firstResult.Kind);

        bool sawSecondApproval = false;
        PermissionRequestResult secondResult = await coordinator.RequestApprovalAsync(
            command,
            command.Pattern.Agents[0],
            new PermissionRequestRead
            {
                Kind = "read",
                ToolCallId = "tool-call-read-2",
                Intention = "Inspect docs guidance",
                Path = "docs\\guide.md",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["tool-call-read-2"] = "grep",
            },
            approval =>
            {
                sawSecondApproval = true;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.False(sawSecondApproval);
        Assert.Equal(PermissionRequestResultKind.Approved, secondResult.Kind);
    }

    [Fact]
    public async Task RequestApprovalAsync_AlwaysApproveCacheDoesNotCarryAcrossTurnRequests()
    {
        CopilotApprovalCoordinator coordinator = new();
        ApprovalRequestedEventDto? firstApproval = null;
        RunTurnCommandDto firstCommand = CreateApprovalCommand();

        Task<PermissionRequestResult> firstPending = coordinator.RequestApprovalAsync(
            firstCommand,
            firstCommand.Pattern.Agents[0],
            new PermissionRequestRead
            {
                Kind = "read",
                ToolCallId = "tool-call-read-1",
                Intention = "Inspect README guidance",
                Path = "README.md",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["tool-call-read-1"] = "view",
            },
            approval =>
            {
                firstApproval = approval;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.NotNull(firstApproval);

        await coordinator.ResolveApprovalAsync(
            new ResolveApprovalCommandDto
            {
                ApprovalId = firstApproval!.ApprovalId,
                Decision = "approved",
                AlwaysApprove = true,
            },
            CancellationToken.None);

        await firstPending;

        ApprovalRequestedEventDto? secondApproval = null;
        RunTurnCommandDto secondCommand = CreateApprovalCommand(requestId: "turn-2");
        Task<PermissionRequestResult> secondPending = coordinator.RequestApprovalAsync(
            secondCommand,
            secondCommand.Pattern.Agents[0],
            new PermissionRequestRead
            {
                Kind = "read",
                ToolCallId = "tool-call-read-2",
                Intention = "Inspect docs guidance",
                Path = "docs\\guide.md",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["tool-call-read-2"] = "grep",
            },
            approval =>
            {
                secondApproval = approval;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.False(secondPending.IsCompleted);
        Assert.NotNull(secondApproval);

        await coordinator.ResolveApprovalAsync(
            new ResolveApprovalCommandDto
            {
                ApprovalId = secondApproval!.ApprovalId,
                Decision = "approved",
            },
            CancellationToken.None);

        PermissionRequestResult secondResult = await secondPending;
        Assert.Equal(PermissionRequestResultKind.Approved, secondResult.Kind);
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

    private static RequestInfoEvent CreateRequestInfoEvent(object payload)
    {
        RequestPort port = RequestPort.Create<object, object>("test-port");
        ExternalRequest request = ExternalRequest.Create(port, payload, "request-1");
        return new RequestInfoEvent(request);
    }

    private static object CreateHandoffTarget(string id, string name)
    {
        Type type = Type.GetType(
            "Microsoft.Agents.AI.Workflows.Specialized.HandoffTarget, Microsoft.Agents.AI.Workflows",
            throwOnError: true)!;
        return Activator.CreateInstance(type, CreateChatClientAgent(id, name), "Handle the UX work.")!;
    }

    private static ChatClientAgent CreateChatClientAgent(string id, string name)
    {
        return new ChatClientAgent(
            new StubChatClient(),
            id,
            name,
            "Stub agent for handoff tests.",
            [],
            null!,
            null!);
    }

    private static RunTurnCommandDto CreateApprovalCommand(string requestId = "turn-1")
    {
        return new RunTurnCommandDto
        {
            RequestId = requestId,
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

    private sealed class StubChatClient : IChatClient
    {
        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options,
            [EnumeratorCancellation]
            CancellationToken cancellationToken)
        {
            yield break;
        }

        public object? GetService(Type serviceType, object? serviceKey)
        {
            return null;
        }

        public void Dispose()
        {
        }
    }
}
