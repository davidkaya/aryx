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

        AgentActivityEventDto activity = Assert.Single(state.DrainPendingActivityEvents());
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

        List<AgentActivityEventDto> activities = [.. state.DrainPendingActivityEvents()];

        await state.EmitThinkingIfNeeded(
            new AgentIdentity("agent-1", "Primary"),
            activity =>
            {
                activities.Add(activity);
                return Task.CompletedTask;
            });

        AgentActivityEventDto thinking = Assert.Single(activities);
        Assert.Equal("thinking", thinking.ActivityType);
        Assert.Equal("agent-1", thinking.AgentId);
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
