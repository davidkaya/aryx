using System.Collections.Concurrent;
using Eryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

internal sealed class CopilotTurnExecutionState
{
    private readonly RunTurnCommandDto _command;
    private readonly HashSet<string> _startedAgents = new(StringComparer.OrdinalIgnoreCase);
    private readonly StreamingTranscriptBuffer _transcriptBuffer = new();
    private int _fallbackMessageIndex;

    public CopilotTurnExecutionState(RunTurnCommandDto command)
    {
        _command = command;
    }

    public ConcurrentDictionary<string, string> ToolNamesByCallId { get; } = new(StringComparer.Ordinal);

    public AgentIdentity? ActiveAgent { get; private set; }

    public List<ChatMessageDto> CompletedMessages { get; private set; } = [];

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

    public string CreateMessageId(string? messageId)
    {
        return messageId ?? $"{_command.RequestId}-delta-{_fallbackMessageIndex++}";
    }

    public (string MessageId, string AuthorName, string Content) AppendDelta(
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

    public void UpdateCompletedMessages(
        IReadOnlyList<ChatMessage> allMessages,
        IReadOnlyList<ChatMessage> inputMessages)
    {
        List<ChatMessage> newMessages = WorkflowTranscriptProjector.SelectNewOutputMessages(allMessages, inputMessages);
        CompletedMessages = WorkflowTranscriptProjector.ProjectCompletedMessages(
            _command,
            newMessages,
            _transcriptBuffer.Snapshot(),
            ActiveAgent);
    }

    public IReadOnlyList<ChatMessageDto> FinalizeCompletedMessages()
    {
        if (CompletedMessages.Count == 0 && _transcriptBuffer.Count > 0)
        {
            CompletedMessages = WorkflowTranscriptProjector.ProjectCompletedMessages(
                _command,
                [],
                _transcriptBuffer.Snapshot(),
                ActiveAgent);
        }

        return CompletedMessages;
    }
}
