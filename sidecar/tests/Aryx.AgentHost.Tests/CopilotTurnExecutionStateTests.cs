using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotTurnExecutionStateTests
{
    [Fact]
    public void ObserveSessionEvent_McpOauthRequired_SetsActiveAgent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            new McpOauthRequiredEvent
            {
                Data = new McpOauthRequiredData
                {
                    RequestId = "oauth-request-1",
                    ServerName = "Example MCP",
                    ServerUrl = "https://example.com/mcp",
                },
            });

        Assert.True(state.ActiveAgent.HasValue);
        Assert.Equal("agent-1", state.ActiveAgent.Value.AgentId);
        Assert.Equal("Primary", state.ActiveAgent.Value.AgentName);
    }

    [Fact]
    public void ObserveSessionEvent_AssistantMessageDelta_QueuesThinkingActivity()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.message_delta",
                  "data": {
                    "messageId": "msg-1",
                    "deltaContent": "Hello"
                  },
                  "id": "11111111-1111-1111-1111-111111111111",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        AgentActivityEventDto activity = Assert.Single(state.DrainPendingEvents().OfType<AgentActivityEventDto>());
        Assert.Equal("thinking", activity.ActivityType);
        Assert.Equal("agent-1", activity.AgentId);
        Assert.Equal("Primary", activity.AgentName);
        Assert.True(state.TryResolveObservedAgentForMessage("msg-1", out AgentIdentity observedAgent));
        Assert.Equal("agent-1", observedAgent.AgentId);
    }

    [Fact]
    public void ObserveSessionEvent_ToolExecutionStart_TracksToolNameByCallId()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "tool.execution_start",
                  "data": {
                    "toolCallId": "tool-call-1",
                    "toolName": "view"
                  },
                  "id": "33333333-3333-3333-3333-333333333333",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        Assert.True(state.ToolNamesByCallId.TryGetValue("tool-call-1", out string? toolName));
        Assert.Equal("view", toolName);
    }

    [Fact]
    public void ObserveSessionEvent_AssistantMessageWithToolRequests_QueuesMessageReclassifiedEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.message",
                  "data": {
                    "messageId": "msg-2",
                    "content": "Let me search for that.",
                    "toolRequests": [
                      {
                        "toolCallId": "tool-call-1",
                        "name": "rg",
                        "arguments": {
                          "pattern": "identifierUri"
                        }
                      }
                    ]
                  },
                  "id": "3f75988b-8e69-4c90-a203-6b01d1c1f90b",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        IReadOnlyList<SidecarEventDto> pending = state.DrainPendingEvents();

        AgentActivityEventDto thinking = Assert.Single(pending.OfType<AgentActivityEventDto>());
        Assert.Equal("thinking", thinking.ActivityType);

        MessageReclassifiedEventDto reclassified = Assert.Single(pending.OfType<MessageReclassifiedEventDto>());
        Assert.Equal("session-1", reclassified.SessionId);
        Assert.Equal("msg-2", reclassified.MessageId);
        Assert.Equal("thinking", reclassified.NewKind);
    }

    [Fact]
    public void ObserveSessionEvent_ToolExecutionStart_ReclassifiesLastObservedMessageOnce()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.message_delta",
                  "data": {
                    "messageId": "msg-3",
                    "deltaContent": "Searching"
                  },
                  "id": "0b65f0e9-d0fb-417e-ab5c-7a3343d8581b",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));
        _ = state.DrainPendingEvents();

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "tool.execution_start",
                  "data": {
                    "toolCallId": "tool-call-1",
                    "toolName": "rg"
                  },
                  "id": "8f33240e-bd3f-475c-aeb6-a4b7908e47b0",
                  "timestamp": "2026-03-27T00:00:01Z"
                }
                """));
        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "tool.execution_start",
                  "data": {
                    "toolCallId": "tool-call-2",
                    "toolName": "view"
                  },
                  "id": "a23f9c9a-f947-4282-866d-f599451c3899",
                  "timestamp": "2026-03-27T00:00:02Z"
                }
                """));

        IReadOnlyList<SidecarEventDto> pending = state.DrainPendingEvents();

        MessageReclassifiedEventDto reclassified = Assert.Single(pending.OfType<MessageReclassifiedEventDto>());
        Assert.Equal("msg-3", reclassified.MessageId);
        Assert.True(state.ToolNamesByCallId.TryGetValue("tool-call-1", out string? firstToolName));
        Assert.Equal("rg", firstToolName);
        Assert.True(state.ToolNamesByCallId.TryGetValue("tool-call-2", out string? secondToolName));
        Assert.Equal("view", secondToolName);
    }

    [Fact]
    public void ObserveSessionEvent_AssistantMessageWithoutToolRequests_DoesNotQueueMessageReclassifiedEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.message",
                  "data": {
                    "messageId": "msg-4",
                    "content": "Final answer."
                  },
                  "id": "d07fe954-1258-4f6a-bf79-1550d6143ed0",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        Assert.Empty(state.DrainPendingEvents().OfType<MessageReclassifiedEventDto>());
    }

    [Fact]
    public async Task EmitThinkingIfNeeded_DoesNotDuplicateQueuedThinkingActivity()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.reasoning_delta",
                  "data": {
                    "reasoningId": "reasoning-1",
                    "deltaContent": "Planning"
                  },
                  "id": "22222222-2222-2222-2222-222222222222",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        List<AgentActivityEventDto> activities = [.. state.DrainPendingEvents().OfType<AgentActivityEventDto>()];

        await state.EmitThinkingIfNeeded(
            new AgentIdentity("agent-1", "Primary"),
            sidecarEvent =>
            {
                activities.Add(Assert.IsType<AgentActivityEventDto>(sidecarEvent));
                return Task.CompletedTask;
            });

        AgentActivityEventDto thinking = Assert.Single(activities);
        Assert.Equal("thinking", thinking.ActivityType);
        Assert.Equal("agent-1", thinking.AgentId);
    }

    [Fact]
    public void ObserveSessionEvent_AssistantIntent_QueuesIntentEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.intent",
                  "data": {
                    "intent": "Searching incident playbooks"
                  },
                  "id": "64cf59fe-63f0-4217-adf4-9bd6b3a80452",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        IReadOnlyList<SidecarEventDto> pending = state.DrainPendingEvents();

        AgentActivityEventDto thinking = Assert.Single(pending.OfType<AgentActivityEventDto>());
        Assert.Equal("thinking", thinking.ActivityType);

        AssistantIntentEventDto intent = Assert.Single(pending.OfType<AssistantIntentEventDto>());
        Assert.Equal("session-1", intent.SessionId);
        Assert.Equal("agent-1", intent.AgentId);
        Assert.Equal("Searching incident playbooks", intent.Intent);
    }

    [Fact]
    public void ObserveSessionEvent_AssistantReasoningDelta_QueuesReasoningDeltaEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.reasoning_delta",
                  "data": {
                    "reasoningId": "reasoning-2",
                    "deltaContent": "Searching logs."
                  },
                  "id": "bd269258-5e5d-46b6-bf3f-bd8cba793b1a",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        IReadOnlyList<SidecarEventDto> pending = state.DrainPendingEvents();

        AgentActivityEventDto thinking = Assert.Single(pending.OfType<AgentActivityEventDto>());
        Assert.Equal("thinking", thinking.ActivityType);

        ReasoningDeltaEventDto reasoning = Assert.Single(pending.OfType<ReasoningDeltaEventDto>());
        Assert.Equal("session-1", reasoning.SessionId);
        Assert.Equal("agent-1", reasoning.AgentId);
        Assert.Equal("reasoning-2", reasoning.ReasoningId);
        Assert.Equal("Searching logs.", reasoning.ContentDelta);
    }

    [Fact]
    public void DrainPendingMcpOauthRequests_ReturnsQueuedRequestsAndClearsQueue()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);
        McpOauthRequiredEventDto request = new()
        {
            Type = "mcp-oauth-required",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            OauthRequestId = "oauth-request-1",
            ServerName = "Example MCP",
            ServerUrl = "https://example.com/mcp",
        };

        state.EnqueuePendingMcpOauthRequest(request);

        IReadOnlyList<McpOauthRequiredEventDto> firstDrain = state.DrainPendingMcpOauthRequests();
        IReadOnlyList<McpOauthRequiredEventDto> secondDrain = state.DrainPendingMcpOauthRequests();

        McpOauthRequiredEventDto drained = Assert.Single(firstDrain);
        Assert.Equal("oauth-request-1", drained.OauthRequestId);
        Assert.Empty(secondDrain);
    }

    [Fact]
    public void ObserveSessionEvent_SubagentStarted_QueuesSubagentEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "subagent.started",
                  "data": {
                    "toolCallId": "tool-call-1",
                    "agentName": "designer",
                    "agentDisplayName": "Designer",
                    "agentDescription": "Design specialist"
                  },
                  "id": "44444444-4444-4444-4444-444444444444",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        SubagentEventDto evt = Assert.Single(state.DrainPendingEvents().OfType<SubagentEventDto>());
        Assert.Equal("started", evt.EventKind);
        Assert.Equal("tool-call-1", evt.ToolCallId);
        Assert.Equal("designer", evt.CustomAgentName);
        Assert.Equal("Designer", evt.CustomAgentDisplayName);
    }

    [Fact]
    public void ObserveSessionEvent_SkillInvoked_QueuesSkillEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "skill.invoked",
                  "data": {
                    "name": "reviewer",
                    "path": "C:\\skills\\reviewer\\SKILL.md",
                    "content": "# Reviewer",
                    "allowedTools": ["view"],
                    "pluginName": "aryx-plugin",
                    "pluginVersion": "1.0.0"
                  },
                  "id": "55555555-5555-5555-5555-555555555555",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        SkillInvokedEventDto evt = Assert.Single(state.DrainPendingEvents().OfType<SkillInvokedEventDto>());
        Assert.Equal("reviewer", evt.SkillName);
        Assert.Equal(@"C:\skills\reviewer\SKILL.md", evt.Path);
        Assert.Equal(["view"], evt.AllowedTools);
        Assert.Equal("aryx-plugin", evt.PluginName);
    }

    [Fact]
    public void ObserveSessionEvent_HookStart_QueuesHookLifecycleEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(command.Pattern.Agents[0], CreateHookStartEvent());

        HookLifecycleEventDto evt = Assert.Single(state.DrainPendingEvents().OfType<HookLifecycleEventDto>());
        Assert.Equal("start", evt.Phase);
        Assert.Equal("postToolUse", evt.HookType);
        Assert.Equal("hook-1", evt.HookInvocationId);
        Assert.NotNull(evt.Input);
    }

    [Fact]
    public void ObserveSessionEvent_HookEnd_QueuesHookLifecycleEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(command.Pattern.Agents[0], CreateHookEndEvent());

        HookLifecycleEventDto evt = Assert.Single(state.DrainPendingEvents().OfType<HookLifecycleEventDto>());
        Assert.Equal("end", evt.Phase);
        Assert.Equal("postToolUse", evt.HookType);
        Assert.Equal("hook-1", evt.HookInvocationId);
        Assert.True(evt.Success);
    }

    [Fact]
    public void ObserveSessionEvent_HookLifecycleEvents_AreSuppressedWhenConfigured()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command)
        {
            SuppressHookLifecycleEvents = true,
        };

        state.ObserveSessionEvent(command.Pattern.Agents[0], CreateHookStartEvent());
        state.ObserveSessionEvent(command.Pattern.Agents[0], CreateHookEndEvent());

        Assert.Empty(state.DrainPendingEvents());
    }

    [Fact]
    public void ObserveSessionEvent_AssistantUsage_QueuesAssistantUsageEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "assistant.usage",
                  "data": {
                    "model": "gpt-5.4",
                    "inputTokens": 1200,
                    "outputTokens": 300,
                    "cacheReadTokens": 50,
                    "cacheWriteTokens": 10,
                    "cost": 0.42,
                    "duration": 8200,
                    "quotaSnapshots": {
                      "premium_interactions": {
                        "entitlementRequests": 50,
                        "usedRequests": 12,
                        "remainingPercentage": 76,
                        "overage": 0,
                        "overageAllowedWithExhaustedQuota": true,
                        "resetDate": "2026-04-01T00:00:00Z"
                      }
                    },
                    "copilotUsage": {
                      "tokenDetails": [
                        {
                          "batchSize": 1,
                          "costPerBatch": 1,
                          "tokenCount": 1500,
                          "tokenType": "input"
                        }
                      ],
                      "totalNanoAiu": 1200000000
                    }
                  },
                  "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        AssistantUsageEventDto evt = Assert.Single(state.DrainPendingEvents().OfType<AssistantUsageEventDto>());
        Assert.Equal("session-1", evt.SessionId);
        Assert.Equal("agent-1", evt.AgentId);
        Assert.Equal("Primary", evt.AgentName);
        Assert.Equal("gpt-5.4", evt.Model);
        Assert.Equal(1200, evt.InputTokens);
        Assert.Equal(300, evt.OutputTokens);
        Assert.Equal(0.42, evt.Cost);
        Assert.Equal(8200, evt.Duration);
        Assert.Equal(1200000000, evt.TotalNanoAiu);
        QuotaSnapshotDto snapshot = Assert.Single(evt.QuotaSnapshots!.Values);
        Assert.Equal(50, snapshot.EntitlementRequests);
        Assert.Equal(12, snapshot.UsedRequests);
        Assert.Equal(76, snapshot.RemainingPercentage);
    }

    [Fact]
    public void ObserveSessionEvent_SessionCompactionComplete_QueuesCompactionEvent()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "session.compaction_complete",
                  "data": {
                    "success": true,
                    "preCompactionTokens": 1000,
                    "postCompactionTokens": 400,
                    "messagesRemoved": 8,
                    "tokensRemoved": 600,
                    "summaryContent": "Compacted summary",
                    "checkpointNumber": 2,
                    "checkpointPath": "C:\\Users\\me\\.copilot\\session-state\\checkpoint-2.json"
                  },
                  "id": "77777777-7777-7777-7777-777777777777",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        SessionCompactionEventDto evt = Assert.Single(state.DrainPendingEvents().OfType<SessionCompactionEventDto>());
        Assert.Equal("complete", evt.Phase);
        Assert.True(evt.Success);
        Assert.Equal(1000, evt.PreCompactionTokens);
        Assert.Equal(400, evt.PostCompactionTokens);
        Assert.Equal("Compacted summary", evt.SummaryContent);
    }

    [Fact]
    public void ObserveSessionEvent_PendingMessagesModified_QueuesPendingMessageSignal()
    {
        RunTurnCommandDto command = CreateCommand();
        CopilotTurnExecutionState state = new(command);

        state.ObserveSessionEvent(
            command.Pattern.Agents[0],
            SessionEvent.FromJson(
                """
                {
                  "type": "pending_messages.modified",
                  "data": {},
                  "id": "88888888-8888-8888-8888-888888888888",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """));

        PendingMessagesModifiedEventDto evt = Assert.Single(state.DrainPendingEvents().OfType<PendingMessagesModifiedEventDto>());
        Assert.Equal("session-1", evt.SessionId);
        Assert.Equal("agent-1", evt.AgentId);
    }

    private static SessionEvent CreateHookStartEvent()
    {
        return SessionEvent.FromJson(
            """
            {
              "type": "hook.start",
              "data": {
                "hookInvocationId": "hook-1",
                "hookType": "postToolUse",
                "input": {
                  "toolName": "view"
                }
              },
              "id": "66666666-6666-6666-6666-666666666666",
              "timestamp": "2026-03-27T00:00:00Z"
            }
            """);
    }

    private static SessionEvent CreateHookEndEvent()
    {
        return SessionEvent.FromJson(
            """
            {
              "type": "hook.end",
              "data": {
                "hookInvocationId": "hook-1",
                "hookType": "postToolUse",
                "success": true,
                "output": {
                  "status": "ok"
                }
              },
              "id": "99999999-9999-9999-9999-999999999999",
              "timestamp": "2026-03-27T00:00:00Z"
            }
            """);
    }

    private static RunTurnCommandDto CreateCommand()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-1",
                Name = "MCP OAuth Pattern",
                Mode = "single",
                Availability = "available",
                Agents =
                [
                    new PatternAgentDefinitionDto
                    {
                        Id = "agent-1",
                        Name = "Primary",
                        Model = "gpt-5.4",
                        Instructions = "Help with the request.",
                    },
                ],
            },
        };
    }
}
