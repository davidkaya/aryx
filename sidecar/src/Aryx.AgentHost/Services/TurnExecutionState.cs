using System.Collections.Concurrent;
using System.Diagnostics.CodeAnalysis;
using Aryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal class TurnExecutionState
{
    private readonly RunTurnCommandDto _command;
    private readonly IReadOnlyDictionary<string, WorkflowDefinitionDto> _workflowLibrary;
    private readonly IReadOnlyDictionary<string, SubworkflowContext> _agentSubworkflowIndex;
    private readonly HashSet<string> _startedAgents = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _reclassifiedMessageIds = new(StringComparer.Ordinal);
    private readonly ConcurrentQueue<SidecarEventDto> _pendingEvents = new();
    private readonly ConcurrentQueue<McpOauthRequiredEventDto> _pendingMcpOauthRequests = new();
    private readonly ConcurrentDictionary<string, AgentIdentity> _observedAgentsByMessageId = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, ProviderReasoningSnapshot> _reasoningById = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, string> _latestIntentByAgentId = new(StringComparer.Ordinal);
    private readonly StreamingTranscriptBuffer _transcriptBuffer = new();
    private int _fallbackMessageIndex;
    private string? _lastObservedMessageId;

    public TurnExecutionState(RunTurnCommandDto command)
    {
        _command = command;
        _workflowLibrary = WorkflowDefinitionExtensions.CreateWorkflowLibraryMap(command.WorkflowLibrary);
        _agentSubworkflowIndex = AgentIdentityResolver.BuildAgentSubworkflowIndex(command.Workflow, _workflowLibrary);
    }

    public ToolCallRegistry ToolCalls { get; } = new();

    public AgentIdentity? ActiveAgent { get; private set; }

    public List<ChatMessageDto> CompletedMessages { get; private set; } = [];

    public bool HasPendingExitPlanModeRequest { get; private set; }

    public ProviderTurnStreamCapabilities StreamCapabilities { get; private set; } = ProviderTurnStreamCapabilities.None;

    public string? CurrentProviderTurnId { get; private set; }

    public string? LatestCompletedProviderTurnId { get; private set; }

    public bool SuppressHookLifecycleEvents { get; set; }

    public void SetStreamCapabilities(ProviderTurnStreamCapabilities capabilities)
    {
        StreamCapabilities = capabilities ?? throw new ArgumentNullException(nameof(capabilities));
    }

    public AgentIdentity ResolveAgentIdentity(string? agentId, string? agentName)
    {
        return AgentIdentityResolver.ResolveAgentIdentity(
            _command.Workflow,
            _workflowLibrary,
            agentId,
            agentName,
            _agentSubworkflowIndex);
    }

    public bool TryResolveKnownAgentIdentity(string? agentIdentifier, out AgentIdentity agent)
    {
        return AgentIdentityResolver.TryResolveKnownAgentIdentity(
            _command.Workflow,
            _workflowLibrary,
            agentIdentifier,
            _agentSubworkflowIndex,
            out agent);
    }

    public bool TryResolveObservedAgentIdentity(
        string? agentIdentifier,
        AgentIdentity? fallbackAgent,
        out AgentIdentity agent)
    {
        return AgentIdentityResolver.TryResolveObservedAgentIdentity(
            _command.Workflow,
            _workflowLibrary,
            agentIdentifier,
            fallbackAgent,
            _agentSubworkflowIndex,
            out agent);
    }

    public bool TryCreateSubworkflowLifecycleActivity(
        string activityType,
        string? executorId,
        out AgentActivityEventDto activity)
    {
        activity = default!;
        if (!AgentIdentityResolver.TryResolveSubworkflowContext(
                _command.Workflow,
                _workflowLibrary,
                executorId,
                out SubworkflowContext subworkflow))
        {
            return false;
        }

        activity = CreateSubworkflowActivity(activityType, subworkflow);
        return true;
    }

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

    public void QueueCompletedActivity(AgentIdentity agent)
    {
        _pendingEvents.Enqueue(CreateCompletedActivity(agent));
    }

    public void ApplyEvent(SidecarEventDto evt)
    {
        if (evt is AgentActivityEventDto activity
            && string.Equals(activity.ActivityType, "handoff", StringComparison.Ordinal)
            && !string.IsNullOrWhiteSpace(activity.AgentId)
            && !string.IsNullOrWhiteSpace(activity.AgentName))
        {
            ActiveAgent = ResolveAgentIdentity(activity.AgentId, activity.AgentName);
        }
    }

    public void ObserveSessionEvent(WorkflowNodeDto agentDefinition, ProviderSessionEvent sessionEvent)
    {
        AgentIdentity agent = ResolveAgentIdentity(
            agentDefinition.GetAgentId(),
            agentDefinition.GetAgentName());

        switch (sessionEvent)
        {
            case ProviderAssistantMessageDeltaEvent messageDelta:
                RecordObservedAgentForMessage(agent, messageDelta.MessageId);
                QueueThinkingIfNeeded(agent);
                break;
            case ProviderAssistantMessageEvent assistantMessage:
                RecordObservedAgentForMessage(agent, assistantMessage.MessageId);
                QueueThinkingIfNeeded(agent);
                if (assistantMessage.HasToolRequests)
                {
                    QueueMessageReclassifiedIfNeeded(assistantMessage.MessageId);
                }
                break;
            case ProviderToolExecutionStartEvent toolExecutionStart:
                string toolCallId = toolExecutionStart.ToolCallId;
                string toolName = toolExecutionStart.ToolName;
                bool shouldQueueToolActivity = TrackToolCall(toolCallId, toolName, toolExecutionStart.ToolArguments);
                ActiveAgent = agent;
                if (shouldQueueToolActivity)
                {
                    AgentActivityEventDto? toolActivity = CreateToolCallingActivity(
                        agent, toolName, toolCallId, toolExecutionStart.ToolArguments);
                    if (toolActivity is not null)
                    {
                        _pendingEvents.Enqueue(toolActivity);
                    }
                }

                QueueMessageReclassifiedIfNeeded(_lastObservedMessageId);
                break;
            case ProviderToolExecutionProgressEvent toolExecutionProgress:
                ActiveAgent = agent;
                TrackToolExecutionProgress(toolExecutionProgress.ToolCallId, toolExecutionProgress.ProgressMessage);
                break;
            case ProviderToolExecutionPartialResultEvent toolExecutionPartialResult:
                ActiveAgent = agent;
                TrackToolExecutionPartialResult(toolExecutionPartialResult.ToolCallId, toolExecutionPartialResult.PartialOutput);
                break;
            case ProviderToolExecutionCompleteEvent toolExecutionComplete:
                ActiveAgent = agent;
                TrackToolExecutionComplete(toolExecutionComplete);
                break;
            case ProviderAssistantIntentEvent intentEvent:
                ActiveAgent = agent;
                QueueThinkingIfNeeded(agent);
                TrackLatestIntent(agent.AgentId, intentEvent.Intent);
                AssistantIntentEventDto? assistantIntent = CreateAssistantIntentEvent(agent, intentEvent.Intent);
                if (assistantIntent is not null)
                {
                    _pendingEvents.Enqueue(assistantIntent);
                }
                break;
            case ProviderAssistantReasoningDeltaEvent reasoningDelta:
                ActiveAgent = agent;
                QueueThinkingIfNeeded(agent);
                TrackReasoningContent(reasoningDelta.ReasoningId, reasoningDelta.DeltaContent, isComplete: false);
                ReasoningDeltaEventDto? reasoningDeltaEvent = CreateReasoningDeltaEvent(
                    agent,
                    reasoningDelta.ReasoningId,
                    reasoningDelta.DeltaContent);
                if (reasoningDeltaEvent is not null)
                {
                    _pendingEvents.Enqueue(reasoningDeltaEvent);
                }
                break;
            case ProviderAssistantReasoningEvent reasoning:
                ActiveAgent = agent;
                TrackReasoningContent(reasoning.ReasoningId, reasoning.Content, isComplete: true);
                break;
            case ProviderAssistantTurnStartEvent turnStart:
                ActiveAgent = agent;
                CurrentProviderTurnId = turnStart.TurnId;
                break;
            case ProviderAssistantTurnEndEvent turnEnd:
                ActiveAgent = agent;
                LatestCompletedProviderTurnId = turnEnd.TurnId;
                if (string.Equals(CurrentProviderTurnId, turnEnd.TurnId, StringComparison.Ordinal))
                {
                    CurrentProviderTurnId = null;
                }
                break;
            case ProviderSubagentStartedEvent started:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentStartedEvent(agent, started));
                break;
            case ProviderSubagentCompletedEvent completed:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentCompletedEvent(agent, completed));
                break;
            case ProviderSubagentFailedEvent failed:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentFailedEvent(agent, failed));
                break;
            case ProviderSubagentSelectedEvent selected:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentSelectedEvent(agent, selected));
                break;
            case ProviderSubagentDeselectedEvent:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSubagentDeselectedEvent(agent));
                break;
            case ProviderSkillInvokedEvent skillInvoked:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateSkillInvokedEvent(agent, skillInvoked));
                break;
            case ProviderHookStartEvent hookStart:
                ActiveAgent = agent;
                if (!SuppressHookLifecycleEvents)
                {
                    _pendingEvents.Enqueue(CreateHookLifecycleEvent(
                        agent,
                        "start",
                        hookStart.HookInvocationId,
                        hookStart.HookType,
                        input: hookStart.Input));
                }
                break;
            case ProviderHookEndEvent hookEnd:
                ActiveAgent = agent;
                if (!SuppressHookLifecycleEvents)
                {
                    _pendingEvents.Enqueue(CreateHookLifecycleEvent(
                        agent,
                        "end",
                        hookEnd.HookInvocationId,
                        hookEnd.HookType,
                        success: hookEnd.Success,
                        output: hookEnd.Output,
                        error: hookEnd.Error));
                }
                break;
            case ProviderAssistantUsageEvent assistantUsage:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateAssistantUsageEvent(agent, assistantUsage));
                break;
            case ProviderSessionUsageEvent usageInfo:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateUsageEvent(agent, usageInfo));
                break;
            case ProviderSessionCompactionStartEvent compactionStart:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateCompactionStartEvent(agent, compactionStart));
                break;
            case ProviderSessionCompactionCompleteEvent compactionComplete:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreateCompactionCompleteEvent(agent, compactionComplete));
                break;
            case ProviderPendingMessagesModifiedEvent:
                ActiveAgent = agent;
                _pendingEvents.Enqueue(CreatePendingMessagesModifiedEvent(agent));
                break;
            case ProviderMcpOauthRequiredEvent:
                ActiveAgent = agent;
                break;
            case ProviderExitPlanModeRequestedEvent:
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

    public bool TryGetToolExecution(string? toolCallId, [NotNullWhen(true)] out ProviderToolExecutionSnapshot? snapshot)
    {
        return ToolCalls.TryGetExecution(toolCallId, out snapshot);
    }

    public bool TryGetReasoning(string? reasoningId, [NotNullWhen(true)] out ProviderReasoningSnapshot? snapshot)
    {
        snapshot = null;
        return !string.IsNullOrWhiteSpace(reasoningId)
            && _reasoningById.TryGetValue(reasoningId, out snapshot);
    }

    public bool TryGetLatestIntent(string? agentId, [NotNullWhen(true)] out string? intent)
    {
        intent = null;
        return !string.IsNullOrWhiteSpace(agentId)
            && _latestIntentByAgentId.TryGetValue(agentId, out intent);
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
        _lastObservedMessageId = messageId;
    }

    private bool TrackToolCall(
        string toolCallId,
        string toolName,
        IReadOnlyDictionary<string, object?>? toolArguments)
    {
        return ToolCalls.TryRecordToolRequest(toolCallId, toolName, toolArguments);
    }

    private void TrackToolExecutionProgress(string toolCallId, string? progressMessage)
    {
        ToolCalls.RecordProgress(toolCallId, progressMessage);
    }

    private void TrackToolExecutionPartialResult(string toolCallId, string? partialOutput)
    {
        ToolCalls.RecordPartialResult(toolCallId, partialOutput);
    }

    private void TrackToolExecutionComplete(ProviderToolExecutionCompleteEvent toolExecution)
    {
        ToolCalls.RecordCompletion(toolExecution);
    }

    private void TrackLatestIntent(string agentId, string? intent)
    {
        string? normalizedIntent = NormalizeOptionalString(intent);
        if (normalizedIntent is null)
        {
            return;
        }

        _latestIntentByAgentId[agentId] = normalizedIntent;
    }

    private void TrackReasoningContent(string? reasoningId, string? content, bool isComplete)
    {
        string? normalizedReasoningId = NormalizeOptionalString(reasoningId);
        if (normalizedReasoningId is null || content is null)
        {
            return;
        }

        _reasoningById.AddOrUpdate(
            normalizedReasoningId,
            id => new ProviderReasoningSnapshot
            {
                ReasoningId = id,
                Content = content,
                IsComplete = isComplete,
            },
            (_, existing) => existing with
            {
                Content = isComplete ? content : string.Concat(existing.Content, content),
                IsComplete = isComplete || existing.IsComplete,
            });
    }

    private void QueueMessageReclassifiedIfNeeded(string? messageId)
    {
        if (string.IsNullOrWhiteSpace(messageId))
        {
            return;
        }

        string normalizedMessageId = messageId.Trim();
        if (!_reclassifiedMessageIds.Add(normalizedMessageId))
        {
            return;
        }

        _pendingEvents.Enqueue(CreateMessageReclassifiedEvent(normalizedMessageId));
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
            SubworkflowNodeId = agent.Subworkflow?.SubworkflowNodeId,
            SubworkflowName = agent.Subworkflow?.SubworkflowName,
        };
    }

    private AgentActivityEventDto? CreateToolCallingActivity(
        AgentIdentity agent,
        string toolName,
        string toolCallId,
        IReadOnlyDictionary<string, object?>? toolArguments = null)
    {
        if (toolName.StartsWith("handoff_to_", StringComparison.Ordinal))
        {
            return null;
        }

        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            ActivityType = "tool-calling",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            SubworkflowNodeId = agent.Subworkflow?.SubworkflowNodeId,
            SubworkflowName = agent.Subworkflow?.SubworkflowName,
            ToolName = toolName,
            ToolCallId = toolCallId,
            ToolArguments = toolArguments,
        };
    }

    private AgentActivityEventDto CreateCompletedActivity(AgentIdentity agent)
    {
        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            ActivityType = "completed",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            SubworkflowNodeId = agent.Subworkflow?.SubworkflowNodeId,
            SubworkflowName = agent.Subworkflow?.SubworkflowName,
        };
    }

    private AgentActivityEventDto CreateSubworkflowActivity(
        string activityType,
        SubworkflowContext subworkflow)
    {
        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            ActivityType = activityType,
            SubworkflowNodeId = subworkflow.SubworkflowNodeId,
            SubworkflowName = subworkflow.SubworkflowName,
        };
    }

    private MessageReclassifiedEventDto CreateMessageReclassifiedEvent(string messageId)
    {
        return new MessageReclassifiedEventDto
        {
            Type = "message-reclassified",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            MessageId = messageId,
            NewKind = "thinking",
        };
    }

    public void UpdateCompletedMessages(
        IReadOnlyList<ChatMessage> allMessages,
        IReadOnlyList<ChatMessage> inputMessages,
        IProviderTranscriptProjector transcriptProjector)
    {
        ArgumentNullException.ThrowIfNull(transcriptProjector);

        List<ChatMessage> newMessages = transcriptProjector.SelectNewOutputMessages(allMessages, inputMessages);
        CompletedMessages = transcriptProjector.ProjectCompletedMessagesFromSegments(
            _command,
            newMessages,
            _transcriptBuffer.Snapshot(),
            ActiveAgent);
    }

    public IReadOnlyList<ChatMessageDto> FinalizeCompletedMessages(IProviderTranscriptProjector transcriptProjector)
    {
        ArgumentNullException.ThrowIfNull(transcriptProjector);

        if (CompletedMessages.Count == 0 && _transcriptBuffer.Count > 0)
        {
            CompletedMessages = transcriptProjector.ProjectCompletedMessagesFromSegments(
                _command,
                [],
                _transcriptBuffer.Snapshot(),
                ActiveAgent);
        }

        foreach (ChatMessageDto message in CompletedMessages)
        {
            if (_reclassifiedMessageIds.Contains(message.Id))
            {
                message.MessageKind = "thinking";
            }
        }

        return CompletedMessages;
    }

    private SubagentEventDto CreateSubagentStartedEvent(
        AgentIdentity agent,
        ProviderSubagentStartedEvent data)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = "started",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            ToolCallId = data.ToolCallId,
            CustomAgentName = data.AgentName,
            CustomAgentDisplayName = data.AgentDisplayName,
            CustomAgentDescription = data.AgentDescription,
        };
    }

    private SubagentEventDto CreateSubagentCompletedEvent(
        AgentIdentity agent,
        ProviderSubagentCompletedEvent data)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = "completed",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            ToolCallId = data.ToolCallId,
            CustomAgentName = data.AgentName,
            CustomAgentDisplayName = data.AgentDisplayName,
        };
    }

    private SubagentEventDto CreateSubagentFailedEvent(
        AgentIdentity agent,
        ProviderSubagentFailedEvent data)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = "failed",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            ToolCallId = data.ToolCallId,
            CustomAgentName = data.AgentName,
            CustomAgentDisplayName = data.AgentDisplayName,
            Error = data.Error,
        };
    }

    private SubagentEventDto CreateSubagentSelectedEvent(
        AgentIdentity agent,
        ProviderSubagentSelectedEvent data)
    {
        return new SubagentEventDto
        {
            Type = "subagent-event",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            EventKind = "selected",
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            CustomAgentName = data.AgentName,
            CustomAgentDisplayName = data.AgentDisplayName,
            Tools = data.Tools,
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

    private AssistantIntentEventDto? CreateAssistantIntentEvent(
        AgentIdentity agent,
        string? intent)
    {
        string? normalizedIntent = intent?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedIntent))
        {
            return null;
        }

        return new AssistantIntentEventDto
        {
            Type = "assistant-intent",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            Intent = normalizedIntent,
        };
    }

    private ReasoningDeltaEventDto? CreateReasoningDeltaEvent(
        AgentIdentity agent,
        string? reasoningId,
        string? deltaContent)
    {
        if (string.IsNullOrWhiteSpace(reasoningId)
            || string.IsNullOrEmpty(deltaContent))
        {
            return null;
        }

        return new ReasoningDeltaEventDto
        {
            Type = "reasoning-delta",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            ReasoningId = reasoningId,
            ContentDelta = deltaContent,
        };
    }

    private SkillInvokedEventDto CreateSkillInvokedEvent(
        AgentIdentity agent,
        ProviderSkillInvokedEvent data)
    {
        return new SkillInvokedEventDto
        {
            Type = "skill-invoked",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            SkillName = data.SkillName,
            Path = data.Path,
            Content = data.Content,
            AllowedTools = data.AllowedTools,
            PluginName = data.PluginName,
            PluginVersion = data.PluginVersion,
        };
    }

    private HookLifecycleEventDto CreateHookLifecycleEvent(
        AgentIdentity agent,
        string phase,
        string hookInvocationId,
        string hookType,
        object? input = null,
        bool? success = null,
        object? output = null,
        string? error = null)
    {
        return new HookLifecycleEventDto
        {
            Type = "hook-lifecycle",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            HookInvocationId = hookInvocationId,
            HookType = hookType,
            Phase = phase,
            Input = input,
            Success = success,
            Output = output,
            Error = error,
        };
    }

    private AssistantUsageEventDto CreateAssistantUsageEvent(
        AgentIdentity agent,
        ProviderAssistantUsageEvent data)
    {
        return new AssistantUsageEventDto
        {
            Type = "assistant-usage",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            Model = data.Model,
            InputTokens = data.InputTokens,
            OutputTokens = data.OutputTokens,
            CacheReadTokens = data.CacheReadTokens,
            CacheWriteTokens = data.CacheWriteTokens,
            Cost = data.Cost,
            Duration = data.Duration,
            TotalNanoAiu = data.TotalNanoAiu,
            QuotaSnapshots = data.QuotaSnapshots,
        };
    }

    private SessionUsageEventDto CreateUsageEvent(AgentIdentity agent, ProviderSessionUsageEvent data)
    {
        return new SessionUsageEventDto
        {
            Type = "session-usage",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            TokenLimit = data.TokenLimit,
            CurrentTokens = data.CurrentTokens,
            MessagesLength = data.MessagesLength,
            SystemTokens = data.SystemTokens,
            ConversationTokens = data.ConversationTokens,
            ToolDefinitionsTokens = data.ToolDefinitionsTokens,
            IsInitial = data.IsInitial,
        };
    }

    private SessionCompactionEventDto CreateCompactionStartEvent(
        AgentIdentity agent,
        ProviderSessionCompactionStartEvent data)
    {
        return new SessionCompactionEventDto
        {
            Type = "session-compaction",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            Phase = "start",
            SystemTokens = data.SystemTokens,
            ConversationTokens = data.ConversationTokens,
            ToolDefinitionsTokens = data.ToolDefinitionsTokens,
        };
    }

    private SessionCompactionEventDto CreateCompactionCompleteEvent(
        AgentIdentity agent,
        ProviderSessionCompactionCompleteEvent data)
    {
        return new SessionCompactionEventDto
        {
            Type = "session-compaction",
            RequestId = _command.RequestId,
            SessionId = _command.SessionId,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            Phase = "complete",
            Success = data.Success,
            Error = data.Error,
            SystemTokens = data.SystemTokens,
            ConversationTokens = data.ConversationTokens,
            ToolDefinitionsTokens = data.ToolDefinitionsTokens,
            PreCompactionTokens = data.PreCompactionTokens,
            PostCompactionTokens = data.PostCompactionTokens,
            PreCompactionMessagesLength = data.PreCompactionMessagesLength,
            MessagesRemoved = data.MessagesRemoved,
            TokensRemoved = data.TokensRemoved,
            SummaryContent = data.SummaryContent,
            CheckpointNumber = data.CheckpointNumber,
            CheckpointPath = data.CheckpointPath,
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

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
