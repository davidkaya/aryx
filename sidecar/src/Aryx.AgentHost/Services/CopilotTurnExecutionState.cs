using System.Collections.Concurrent;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotTurnExecutionState
{
    private readonly RunTurnCommandDto _command;
    private readonly HashSet<string> _startedAgents = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentQueue<SidecarEventDto> _pendingEvents = new();
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

    public bool SuppressHookLifecycleEvents { get; set; }

    public async Task EmitThinkingIfNeeded(
        AgentIdentity agent,
        Func<SidecarEventDto, Task> onEvent)
    {
        AgentActivityEventDto? thinkingActivity = CreateThinkingActivityIfNeeded(agent);
        if (thinkingActivity is null)
        {
            return;
        }

        await onEvent(thinkingActivity).ConfigureAwait(false);
    }

    public void QueueThinkingIfNeeded(AgentIdentity agent)
    {
        AgentActivityEventDto? thinkingActivity = CreateThinkingActivityIfNeeded(agent);
        if (thinkingActivity is not null)
        {
            _pendingEvents.Enqueue(thinkingActivity);
        }
    }

    public void ApplyEvent(SidecarEventDto evt)
    {
        if (evt is AgentActivityEventDto activity
            && string.Equals(activity.ActivityType, "handoff", StringComparison.Ordinal)
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
                QueueThinkingIfNeeded(agent);
                break;
            case AssistantMessageEvent assistantMessage when !string.IsNullOrWhiteSpace(assistantMessage.Data?.MessageId):
                RecordObservedAgentForMessage(agent, assistantMessage.Data!.MessageId);
                QueueThinkingIfNeeded(agent);
                break;
            case ToolExecutionStartEvent toolExecutionStart
                when !string.IsNullOrWhiteSpace(toolExecutionStart.Data?.ToolCallId)
                    && !string.IsNullOrWhiteSpace(toolExecutionStart.Data?.ToolName):
                ToolNamesByCallId[toolExecutionStart.Data.ToolCallId.Trim()] = toolExecutionStart.Data.ToolName.Trim();
                break;
            case AssistantReasoningDeltaEvent:
                ActiveAgent = agent;
                QueueThinkingIfNeeded(agent);
                break;
            case SubagentStartedEvent started:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentEvent(agent, "started", started.Data));
                break;
            case SubagentCompletedEvent completed:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentCompletedEvent(agent, completed.Data));
                break;
            case SubagentFailedEvent failed:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentFailedEvent(agent, failed.Data));
                break;
            case SubagentSelectedEvent selected:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentSelectedEvent(agent, selected.Data));
                break;
            case SubagentDeselectedEvent:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentDeselectedEvent(agent));
                break;
            case SkillInvokedEvent skillInvoked:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSkillInvokedEvent(agent, skillInvoked.Data));
                break;
            case HookStartEvent hookStart:
                ActiveAgent = agent;
                if (!SuppressHookLifecycleEvents)
                {
                    _pendingEvents.Enqueue(CreateHookLifecycleEvent(agent, "start", hookStart.Data));
                }
                break;
            case HookEndEvent hookEnd:
                ActiveAgent = agent;
                if (!SuppressHookLifecycleEvents)
                {
                    _pendingEvents.Enqueue(CreateHookLifecycleEvent(agent, "end", hookEnd.Data));
                }
                break;
            case AssistantUsageEvent assistantUsage:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateAssistantUsageEvent(agent, assistantUsage.Data));
                break;
            case SessionUsageInfoEvent usageInfo:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateUsageEvent(agent, usageInfo.Data));
                break;
            case SessionCompactionStartEvent compactionStart:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateCompactionStartEvent(agent, compactionStart.Data));
                break;
            case SessionCompactionCompleteEvent compactionComplete:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateCompactionCompleteEvent(agent, compactionComplete.Data));
                break;
            case PendingMessagesModifiedEvent:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreatePendingMessagesModifiedEvent(agent));
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

    public IReadOnlyList<SidecarEventDto> DrainPendingEvents()
    {
        List<SidecarEventDto> pending = [];
        while (_pendingEvents.TryDequeue(out SidecarEventDto? pendingEvent))
        {
            pending.Add(pendingEvent);
        }

        return pending;
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

    private AgentActivityEventDto? CreateThinkingActivityIfNeeded(AgentIdentity agent)
    {
        ActiveAgent = agent;

        if (!_startedAgents.Add(agent.AgentId))
        {
            return null;
        }

        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            ActivityType = "thinking",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
        };
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

    private SubagentEventDto CreateSubagentEvent(
        AgentIdentity agent,
        string eventKind,
        SubagentStartedData? data)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = eventKind,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            ToolCallId = data?.ToolCallId,
            CustomAgentName = data?.AgentName,
            CustomAgentDisplayName = data?.AgentDisplayName,
            CustomAgentDescription = data?.AgentDescription,
        };
    }

    private SubagentEventDto CreateSubagentCompletedEvent(
        AgentIdentity agent,
        SubagentCompletedData? data)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = "completed",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            ToolCallId = data?.ToolCallId,
            CustomAgentName = data?.AgentName,
            CustomAgentDisplayName = data?.AgentDisplayName,
        };
    }

    private SubagentEventDto CreateSubagentFailedEvent(
        AgentIdentity agent,
        SubagentFailedData? data)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = "failed",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            ToolCallId = data?.ToolCallId,
            CustomAgentName = data?.AgentName,
            CustomAgentDisplayName = data?.AgentDisplayName,
            Error = data?.Error,
        };
    }

    private SubagentEventDto CreateSubagentSelectedEvent(
        AgentIdentity agent,
        SubagentSelectedData? data)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = "selected",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            CustomAgentName = data?.AgentName,
            CustomAgentDisplayName = data?.AgentDisplayName,
            Tools = data?.Tools,
        };
    }

    private SubagentEventDto CreateSubagentDeselectedEvent(AgentIdentity agent)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = "deselected",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
        };
    }

    private SkillInvokedEventDto CreateSkillInvokedEvent(
        AgentIdentity agent,
        SkillInvokedData? data)
    {
        return new SkillInvokedEventDto
        {
            Type = "skill-invoked",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            SkillName = data?.Name ?? string.Empty,
            Path = data?.Path ?? string.Empty,
            Content = data?.Content ?? string.Empty,
            AllowedTools = data?.AllowedTools,
            PluginName = data?.PluginName,
            PluginVersion = data?.PluginVersion,
        };
    }

    private HookLifecycleEventDto CreateHookLifecycleEvent(
        AgentIdentity agent,
        string phase,
        HookStartData? data)
    {
        return new HookLifecycleEventDto
        {
            Type = "hook-lifecycle",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            HookInvocationId = data?.HookInvocationId ?? string.Empty,
            HookType = data?.HookType ?? string.Empty,
            Phase = phase,
            Input = data?.Input,
        };
    }

    private HookLifecycleEventDto CreateHookLifecycleEvent(
        AgentIdentity agent,
        string phase,
        HookEndData? data)
    {
        return new HookLifecycleEventDto
        {
            Type = "hook-lifecycle",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            HookInvocationId = data?.HookInvocationId ?? string.Empty,
            HookType = data?.HookType ?? string.Empty,
            Phase = phase,
            Success = data?.Success,
            Output = data?.Output,
            Error = data?.Error?.Message,
        };
    }

    private AssistantUsageEventDto CreateAssistantUsageEvent(
        AgentIdentity agent,
        AssistantUsageData? data)
    {
        return new AssistantUsageEventDto
        {
            Type = "assistant-usage",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            Model = data?.Model ?? string.Empty,
            InputTokens = data?.InputTokens,
            OutputTokens = data?.OutputTokens,
            CacheReadTokens = data?.CacheReadTokens,
            CacheWriteTokens = data?.CacheWriteTokens,
            Cost = data?.Cost,
            Duration = data?.Duration,
            TotalNanoAiu = data?.CopilotUsage?.TotalNanoAiu,
            QuotaSnapshots = QuotaSnapshotMapper.MapOrNull(data?.QuotaSnapshots),
        };
    }

    private SessionUsageEventDto CreateUsageEvent(AgentIdentity agent, SessionUsageInfoData? data)
    {
        return new SessionUsageEventDto
        {
            Type = "session-usage",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            TokenLimit = data?.TokenLimit ?? 0,
            CurrentTokens = data?.CurrentTokens ?? 0,
            MessagesLength = data?.MessagesLength ?? 0,
            SystemTokens = data?.SystemTokens,
            ConversationTokens = data?.ConversationTokens,
            ToolDefinitionsTokens = data?.ToolDefinitionsTokens,
            IsInitial = data?.IsInitial,
        };
    }

    private SessionCompactionEventDto CreateCompactionStartEvent(
        AgentIdentity agent,
        SessionCompactionStartData? data)
    {
        return new SessionCompactionEventDto
        {
            Type = "session-compaction",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            Phase = "start",
            SystemTokens = data?.SystemTokens,
            ConversationTokens = data?.ConversationTokens,
            ToolDefinitionsTokens = data?.ToolDefinitionsTokens,
        };
    }

    private SessionCompactionEventDto CreateCompactionCompleteEvent(
        AgentIdentity agent,
        SessionCompactionCompleteData? data)
    {
        return new SessionCompactionEventDto
        {
            Type = "session-compaction",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            Phase = "complete",
            Success = data?.Success,
            Error = data?.Error,
            SystemTokens = data?.SystemTokens,
            ConversationTokens = data?.ConversationTokens,
            ToolDefinitionsTokens = data?.ToolDefinitionsTokens,
            PreCompactionTokens = data?.PreCompactionTokens,
            PostCompactionTokens = data?.PostCompactionTokens,
            PreCompactionMessagesLength = data?.PreCompactionMessagesLength,
            MessagesRemoved = data?.MessagesRemoved,
            TokensRemoved = data?.TokensRemoved,
            SummaryContent = data?.SummaryContent,
            CheckpointNumber = data?.CheckpointNumber,
            CheckpointPath = data?.CheckpointPath,
        };
    }

    private PendingMessagesModifiedEventDto CreatePendingMessagesModifiedEvent(AgentIdentity agent)
    {
        return new PendingMessagesModifiedEventDto
        {
            Type = "pending-messages-modified",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
        };
    }
}
