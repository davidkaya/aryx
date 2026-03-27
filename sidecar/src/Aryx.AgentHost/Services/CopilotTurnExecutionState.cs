using System.Collections.Concurrent;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotTurnExecutionState
{
    private readonly RunTurnCommandDto _command;
    private readonly HashSet<string> _startedAgents = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentQueue<McpOauthRequiredEventDto> _pendingMcpOauthRequests = new();
    private readonly ConcurrentDictionary<string, AgentIdentity> _observedAgentsByMessageId = new(StringComparer.Ordinal);
    private readonly StreamingTranscriptBuffer _transcriptBuffer = new();
    private int _fallbackMessageIndex;

    public CopilotTurnExecutionState(RunTurnCommandDto command)
    {
        _command = command;
    }

    public ConcurrentDictionary<string, string> ToolNamesByCallId { get; } = new(StringComparer.Ordinal);

    public AgentIdentity? ActiveAgent { get; private set; }

    public List<ChatMessageDto> CompletedMessages { get; private set; } = [];

    public bool HasPendingExitPlanModeRequest { get; private set; }

    public async Task EmitThinkingIfNeeded(
        AgentIdentity agent,
        Func<AgentActivityEventDto, Task> onActivity)
    {
        ActiveAgent = agent;

        if (!_startedAgents.Add(agent.AgentId))
        {
            return;
        }

        await onActivity(new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            ActivityType = "thinking",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
        }).ConfigureAwait(false);
    }

    public void ApplyActivity(AgentActivityEventDto activity)
    {
        if (string.Equals(activity.ActivityType, "handoff", StringComparison.Ordinal)
            && !string.IsNullOrWhiteSpace(activity.AgentId)
            && !string.IsNullOrWhiteSpace(activity.AgentName))
        {
            ActiveAgent = new AgentIdentity(activity.AgentId, activity.AgentName);
        }
    }

    public void ObserveSessionEvent(PatternAgentDefinitionDto agentDefinition, SessionEvent sessionEvent)
    {
        AgentIdentity agent = AgentIdentityResolver.ResolveAgentIdentity(
            _command.Pattern,
            agentDefinition.Id,
            agentDefinition.Name);

        switch (sessionEvent)
        {
            case AssistantMessageDeltaEvent messageDelta when !string.IsNullOrWhiteSpace(messageDelta.Data?.MessageId):
                RecordObservedAgentForMessage(agent, messageDelta.Data!.MessageId);
                break;
            case AssistantMessageEvent assistantMessage when !string.IsNullOrWhiteSpace(assistantMessage.Data?.MessageId):
                RecordObservedAgentForMessage(agent, assistantMessage.Data!.MessageId);
                break;
            case AssistantReasoningDeltaEvent:
                ActiveAgent = agent;
                break;
            case McpOauthRequiredEvent:
                ActiveAgent = agent;
                break;
            case ExitPlanModeRequestedEvent:
                HasPendingExitPlanModeRequest = true;
                ActiveAgent = agent;
                break;
        }
    }

    public void EnqueuePendingMcpOauthRequest(McpOauthRequiredEventDto request)
    {
        ArgumentNullException.ThrowIfNull(request);
        _pendingMcpOauthRequests.Enqueue(request);
    }

    public IReadOnlyList<McpOauthRequiredEventDto> DrainPendingMcpOauthRequests()
    {
        List<McpOauthRequiredEventDto> pending = [];
        while (_pendingMcpOauthRequests.TryDequeue(out McpOauthRequiredEventDto? request))
        {
            pending.Add(request);
        }

        return pending;
    }

    public bool TryResolveObservedAgentForMessage(string? messageId, out AgentIdentity agent)
    {
        agent = default;
        return !string.IsNullOrWhiteSpace(messageId)
            && _observedAgentsByMessageId.TryGetValue(messageId, out agent);
    }

    public string CreateMessageId(string? messageId)
    {
        return messageId ?? $"{_command.RequestId}-delta-{_fallbackMessageIndex++}";
    }

    public TranscriptSegment AppendDelta(
        string messageId,
        string authorName,
        string delta)
    {
        return _transcriptBuffer.AppendDelta(messageId, authorName, delta);
    }

    public void ClearActiveAgentIfMatching(AgentIdentity completedAgent)
    {
        if (ActiveAgent.HasValue
            && string.Equals(ActiveAgent.Value.AgentId, completedAgent.AgentId, StringComparison.Ordinal))
        {
            ActiveAgent = null;
        }
    }

    private void RecordObservedAgentForMessage(AgentIdentity agent, string messageId)
    {
        ActiveAgent = agent;
        _observedAgentsByMessageId[messageId] = agent;
    }

    public void UpdateCompletedMessages(
        IReadOnlyList<ChatMessage> allMessages,
        IReadOnlyList<ChatMessage> inputMessages)
    {
        List<ChatMessage> newMessages = WorkflowTranscriptProjector.SelectNewOutputMessages(allMessages, inputMessages);
        CompletedMessages = WorkflowTranscriptProjector.ProjectCompletedMessagesFromSegments(
            _command,
            newMessages,
            _transcriptBuffer.Snapshot(),
            ActiveAgent);
    }

    public IReadOnlyList<ChatMessageDto> FinalizeCompletedMessages()
    {
        if (CompletedMessages.Count == 0 && _transcriptBuffer.Count > 0)
        {
            CompletedMessages = WorkflowTranscriptProjector.ProjectCompletedMessagesFromSegments(
                _command,
                [],
                _transcriptBuffer.Snapshot(),
                ActiveAgent);
        }

        return CompletedMessages;
    }
}
