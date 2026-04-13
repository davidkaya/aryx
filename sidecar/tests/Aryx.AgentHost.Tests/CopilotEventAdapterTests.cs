using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotEventAdapterTests
{
    private static readonly CopilotEventAdapter Adapter = new();

    [Fact]
    public void Capabilities_AdvertiseRichTurnStreamSupport()
    {
        ProviderTurnStreamCapabilities capabilities = Adapter.Capabilities;

        Assert.True(capabilities.SupportsIntent);
        Assert.True(capabilities.SupportsReasoningDelta);
        Assert.True(capabilities.SupportsReasoningBlock);
        Assert.True(capabilities.SupportsToolExecutionProgress);
        Assert.True(capabilities.SupportsToolExecutionPartialResult);
        Assert.True(capabilities.SupportsToolExecutionCompletion);
        Assert.True(capabilities.SupportsSubagentLifecycle);
        Assert.True(capabilities.SupportsHookLifecycle);
        Assert.True(capabilities.SupportsSessionCompaction);
        Assert.True(capabilities.SupportsPendingMessagesMutation);
        Assert.True(capabilities.SupportsSessionTurnBoundaries);
    }

    [Fact]
    public void TryAdapt_ToolExecutionComplete_MapsNormalizedResult()
    {
        ProviderToolExecutionCompleteEvent evt = Assert.IsType<ProviderToolExecutionCompleteEvent>(
            Adapter.TryAdapt(SessionEvent.FromJson(
                """
                {
                  "type": "tool.execution_complete",
                  "data": {
                    "toolCallId": "tool-call-1",
                    "success": true,
                    "result": {
                      "content": "summary",
                      "detailedContent": "summary\nfull"
                    }
                  },
                  "id": "11111111-2222-3333-4444-555555555555",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """)));

        Assert.Equal("tool-call-1", evt.ToolCallId);
        Assert.True(evt.Success);
        Assert.Equal("summary", evt.ResultContent);
        Assert.Equal("summary\nfull", evt.DetailedResultContent);
        Assert.Null(evt.Error);
    }

    [Fact]
    public void TryAdapt_AssistantReasoning_MapsCompletedReasoningBlock()
    {
        ProviderAssistantReasoningEvent evt = Assert.IsType<ProviderAssistantReasoningEvent>(
            Adapter.TryAdapt(SessionEvent.FromJson(
                """
                {
                  "type": "assistant.reasoning",
                  "data": {
                    "reasoningId": "reasoning-1",
                    "content": "Planning the next step."
                  },
                  "id": "66666666-7777-8888-9999-aaaaaaaaaaaa",
                  "timestamp": "2026-03-27T00:00:00Z"
                }
                """)));

        Assert.Equal("reasoning-1", evt.ReasoningId);
        Assert.Equal("Planning the next step.", evt.Content);
    }
}
