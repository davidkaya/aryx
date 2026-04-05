using System.IO;
using System.Linq;
using System.Globalization;
using System.Text.Json;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Agents.AI.Workflows.Checkpointing;
using Microsoft.Agents.AI.Workflows.InProc;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

public sealed class CopilotWorkflowRunner : ITurnWorkflowRunner
{
    private const string HandoffFunctionPrefix = "handoff_to_";
    private readonly PatternValidator _patternValidator;
    private readonly WorkflowValidator _workflowValidator;
    private readonly WorkflowRunner _workflowRunner = new();
    private readonly CopilotApprovalCoordinator _approvalCoordinator = new();
    private readonly CopilotUserInputCoordinator _userInputCoordinator = new();
    private readonly CopilotMcpOAuthCoordinator _mcpOAuthCoordinator = new();
    private readonly CopilotExitPlanModeCoordinator _exitPlanModeCoordinator = new();

    public CopilotWorkflowRunner(PatternValidator patternValidator, WorkflowValidator? workflowValidator = null)
    {
        _patternValidator = patternValidator;
        _workflowValidator = workflowValidator ?? new WorkflowValidator();
    }

    public async Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
        RunTurnCommandDto command,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<SidecarEventDto, Task> onEvent,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        Func<McpOauthRequiredEventDto, Task> onMcpOAuthRequired,
        Func<ExitPlanModeRequestedEventDto, Task> onExitPlanMode,
        CancellationToken cancellationToken)
    {
        string? validationError = command.Workflow is null
            ? _patternValidator.Validate(command.Pattern).FirstOrDefault()?.Message
            : _workflowValidator.Validate(command.Workflow, command.WorkflowLibrary).FirstOrDefault()?.Message;
        if (validationError is not null)
        {
            throw new InvalidOperationException(validationError);
        }

        CopilotTurnExecutionState state = new(command);
        using CancellationTokenSource runCancellation =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        try
        {
            await using CopilotAgentBundle bundle = await CopilotAgentBundle.CreateAsync(
                command,
                (agent, request, invocation) => _approvalCoordinator.RequestApprovalAsync(
                    command,
                    agent,
                    request,
                    invocation,
                    state.ToolNamesByCallId,
                    activity => EmitActivityAsync(command, state, activity, onEvent),
                    onApproval,
                    runCancellation.Token),
                (agent, request, invocation) => _userInputCoordinator.RequestUserInputAsync(
                    command,
                    agent,
                    request,
                    invocation,
                    onUserInput,
                    runCancellation.Token),
                (agent, sessionEvent) =>
                {
                    state.ObserveSessionEvent(agent, sessionEvent);
                    if (sessionEvent is McpOauthRequiredEvent mcpOauthRequired)
                    {
                        state.EnqueuePendingMcpOauthRequest(
                            _mcpOAuthCoordinator.BuildMcpOauthRequiredEvent(command, agent, mcpOauthRequired));
                    }

                    if (sessionEvent is ExitPlanModeRequestedEvent exitPlanModeRequested)
                    {
                        _exitPlanModeCoordinator.RecordExitPlanModeRequest(command, agent, exitPlanModeRequested);
                        runCancellation.Cancel();
                    }
                },
                runCancellation.Token);
            ConfigureHookLifecycleEventSuppression(state, bundle);
            Workflow workflow = command.Workflow is null
                ? bundle.BuildWorkflow(command.Pattern)
                : _workflowRunner.BuildWorkflow(command.Workflow, command.Pattern, bundle.Agents, command.WorkflowLibrary);
            List<ChatMessage> inputMessages = command.Messages.Select(WorkflowTranscriptProjector.ToChatMessage).ToList();
            WorkflowTranscriptProjector.AttachMessageMode(inputMessages, command.MessageMode);

            using FileSystemJsonCheckpointStore? checkpointStore = CreateCheckpointStore(command);
            CheckpointManager? checkpointManager = checkpointStore is not null
                ? CheckpointManager.CreateJson(checkpointStore)
                : null;

            await using StreamingRun run = await OpenWorkflowRunAsync(
                command,
                workflow,
                inputMessages,
                checkpointManager).ConfigureAwait(false);
            await run.TrySendMessageAsync(new TurnToken(emitEvents: true)).ConfigureAwait(false);

            await foreach (WorkflowEvent evt in run.WatchStreamAsync(runCancellation.Token).ConfigureAwait(false))
            {
                if (evt is RequestInfoEvent requestInfo
                    && await TryHandleRequestPortRequestAsync(
                        command,
                        requestInfo,
                        run,
                        onUserInput,
                        runCancellation.Token).ConfigureAwait(false))
                {
                    continue;
                }

                bool shouldEndTurn = await HandleWorkflowEventAsync(command, evt, inputMessages, state, onDelta, onEvent)
                    .ConfigureAwait(false);
                await EmitPendingEventsAsync(state, onEvent).ConfigureAwait(false);
                await EmitPendingMcpOauthRequestsAsync(state, onMcpOAuthRequired).ConfigureAwait(false);
                if (shouldEndTurn)
                {
                    break;
                }
            }

            await EmitPendingEventsAsync(state, onEvent).ConfigureAwait(false);
            await EmitPendingMcpOauthRequestsAsync(state, onMcpOAuthRequired).ConfigureAwait(false);
            return state.FinalizeCompletedMessages();
        }
        catch (OperationCanceledException) when (runCancellation.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            await EmitPendingEventsAsync(state, onEvent).ConfigureAwait(false);
            await EmitPendingMcpOauthRequestsAsync(state, onMcpOAuthRequired).ConfigureAwait(false);
            ExitPlanModeRequestedEventDto? exitPlanModeEvent =
                _exitPlanModeCoordinator.ConsumePendingRequest(command.RequestId);
            if (exitPlanModeEvent is null || !state.HasPendingExitPlanModeRequest)
            {
                throw;
            }

            await onExitPlanMode(exitPlanModeEvent).ConfigureAwait(false);
            return state.FinalizeCompletedMessages();
        }
        finally
        {
            _approvalCoordinator.ClearRequestApprovals(command.RequestId);
        }
    }

    internal static FileSystemJsonCheckpointStore? CreateCheckpointStore(RunTurnCommandDto command)
    {
        if (!ShouldEnableWorkflowCheckpointing(command))
        {
            return null;
        }

        DirectoryInfo checkpointDirectory = new(GetCheckpointStorePath(command));
        return new FileSystemJsonCheckpointStore(checkpointDirectory);
    }

    internal static bool ShouldEnableWorkflowCheckpointing(RunTurnCommandDto command)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.Workflow is not null)
        {
            return command.Workflow.Settings.Checkpointing.Enabled;
        }

        return string.Equals(command.Pattern.Mode, "handoff", StringComparison.OrdinalIgnoreCase);
    }

    internal static string GetCheckpointStorePath(RunTurnCommandDto command)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (!string.IsNullOrWhiteSpace(command.ResumeFromCheckpoint?.StorePath))
        {
            return command.ResumeFromCheckpoint.StorePath;
        }

        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(localAppData, "Aryx", "workflow-checkpoints", command.SessionId, command.RequestId);
    }

    private static ValueTask<StreamingRun> OpenWorkflowRunAsync(
        RunTurnCommandDto command,
        Workflow workflow,
        IReadOnlyList<ChatMessage> inputMessages,
        CheckpointManager? checkpointManager)
    {
        InProcessExecutionEnvironment environment = CreateExecutionEnvironment(command, checkpointManager);
        if (checkpointManager is not null && command.ResumeFromCheckpoint is { } resumeFromCheckpoint)
        {
            return environment.ResumeStreamingAsync(
                workflow,
                new CheckpointInfo(resumeFromCheckpoint.WorkflowSessionId, resumeFromCheckpoint.CheckpointId));
        }

        return environment.RunStreamingAsync(workflow, inputMessages.ToList(), command.RequestId);
    }

    internal static InProcessExecutionEnvironment CreateExecutionEnvironment(
        RunTurnCommandDto command,
        CheckpointManager? checkpointManager)
    {
        ArgumentNullException.ThrowIfNull(command);

        string executionMode = command.Workflow?.Settings.ExecutionMode?.Trim() ?? "off-thread";
        InProcessExecutionEnvironment environment = string.Equals(
            executionMode,
            "lockstep",
            StringComparison.OrdinalIgnoreCase)
            ? InProcessExecution.Lockstep
            : InProcessExecution.OffThread;

        return checkpointManager is null ? environment : environment.WithCheckpointing(checkpointManager);
    }

    internal static void ConfigureHookLifecycleEventSuppression(
        CopilotTurnExecutionState state,
        CopilotAgentBundle bundle)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(bundle);

        state.SuppressHookLifecycleEvents = !bundle.HasConfiguredHooks;
    }

    private static async Task EmitPendingEventsAsync(
        CopilotTurnExecutionState state,
        Func<SidecarEventDto, Task> onEvent)
    {
        foreach (SidecarEventDto pendingEvent in state.DrainPendingEvents())
        {
            await onEvent(pendingEvent).ConfigureAwait(false);
        }
    }

    private static async Task EmitPendingMcpOauthRequestsAsync(
        CopilotTurnExecutionState state,
        Func<McpOauthRequiredEventDto, Task> onMcpOAuthRequired)
    {
        foreach (McpOauthRequiredEventDto request in state.DrainPendingMcpOauthRequests())
        {
            await onMcpOAuthRequired(request).ConfigureAwait(false);
        }
    }

    public Task ResolveApprovalAsync(
        ResolveApprovalCommandDto command,
        CancellationToken cancellationToken)
    {
        return _approvalCoordinator.ResolveApprovalAsync(command, cancellationToken);
    }

    public Task ResolveUserInputAsync(
        ResolveUserInputCommandDto command,
        CancellationToken cancellationToken)
    {
        return _userInputCoordinator.ResolveUserInputAsync(command, cancellationToken);
    }

    private async Task<bool> TryHandleRequestPortRequestAsync(
        RunTurnCommandDto command,
        RequestInfoEvent requestInfo,
        StreamingRun run,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        CancellationToken cancellationToken)
    {
        if (!TryResolveRequestPortMetadata(command.Workflow, requestInfo, out WorkflowRequestPortMetadata? metadata))
        {
            return false;
        }

        UserInputRequest userInputRequest = CreateRequestPortUserInputRequest(metadata!, requestInfo);
        UserInputResponse response = await _userInputCoordinator.RequestUserInputAsync(
            command,
            userInputRequest,
            onUserInput,
            cancellationToken).ConfigureAwait(false);

        object coercedResponse = CoerceRequestPortResponse(metadata!.ResponseType, response.Answer);
        await run.SendResponseAsync(requestInfo.Request.CreateResponse(coercedResponse)).ConfigureAwait(false);
        return true;
    }

    private static async Task<bool> HandleWorkflowEventAsync(
        RunTurnCommandDto command,
        WorkflowEvent evt,
        IReadOnlyList<ChatMessage> inputMessages,
        CopilotTurnExecutionState state,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<SidecarEventDto, Task> onEvent)
    {
        if (evt is ExecutorInvokedEvent invoked)
        {
            if (AgentIdentityResolver.TryResolveKnownAgentIdentity(
                command.Pattern,
                invoked.ExecutorId,
                out AgentIdentity invokedAgent))
            {
                TraceHandoff(command, $"Executor invoked: {invoked.ExecutorId} -> {invokedAgent.AgentName} ({invokedAgent.AgentId}).");
                await state.EmitThinkingIfNeeded(invokedAgent, onEvent).ConfigureAwait(false);
            }
            else
            {
                TraceHandoff(command, $"Executor invoked without a known agent match: {invoked.ExecutorId}.");
            }

            return false;
        }

        if (evt is RequestInfoEvent requestInfo)
        {
            AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
                command,
                requestInfo,
                state.ActiveAgent,
                state.ToolNamesByCallId);

            if (activity is null)
            {
                bool requiresBoundary = WorkflowRequestInfoInterpreter.RequiresUserInputTurnBoundary(command, requestInfo);
                TraceHandoff(
                    command,
                    $"Request info produced no activity for data type '{requestInfo.Request.Data.TypeId}'. Requires boundary: {requiresBoundary}.");
                return requiresBoundary;
            }

            await EmitActivityAsync(command, state, activity, onEvent).ConfigureAwait(false);
            return false;
        }

        if (TryCreateWorkflowCheckpointSavedEvent(command, evt, out WorkflowCheckpointSavedEventDto? checkpointSaved))
        {
            await onEvent(checkpointSaved).ConfigureAwait(false);
            return false;
        }

        if (TryCreateWorkflowDiagnosticEvent(command, evt, state, out WorkflowDiagnosticEventDto? diagnostic))
        {
            await onEvent(diagnostic).ConfigureAwait(false);
            return false;
        }

        if (evt is AgentResponseUpdateEvent update)
        {
            await HandleAgentResponseUpdateAsync(command, update, state, onDelta, onEvent).ConfigureAwait(false);
            return false;
        }

        if (evt is ExecutorCompletedEvent completed)
        {
            if (AgentIdentityResolver.TryResolveObservedAgentIdentity(
                command.Pattern,
                completed.ExecutorId,
                state.ActiveAgent,
                out AgentIdentity completedAgent))
            {
                TraceHandoff(command, $"Executor completed: {completed.ExecutorId} -> {completedAgent.AgentName} ({completedAgent.AgentId}).");
                state.ClearActiveAgentIfMatching(completedAgent);
            }
            else
            {
                TraceHandoff(command, $"Executor completed without a known agent match: {completed.ExecutorId}.");
            }

            return false;
        }

        if (evt is WorkflowOutputEvent outputEvent)
        {
            List<ChatMessage> allMessages = outputEvent.As<List<ChatMessage>>() ?? [];
            state.UpdateCompletedMessages(allMessages, inputMessages);
        }

        return false;
    }

    internal static UserInputRequest CreateRequestPortUserInputRequest(
        WorkflowRequestPortMetadata metadata,
        RequestInfoEvent requestInfo)
    {
        ArgumentNullException.ThrowIfNull(metadata);
        ArgumentNullException.ThrowIfNull(requestInfo);

        string question = metadata.Prompt
            ?? BuildRequestPortFallbackQuestion(metadata, requestInfo);

        bool expectsBoolean = IsBooleanResponseType(metadata.ResponseType);
        return new UserInputRequest
        {
            Question = question,
            Choices = expectsBoolean ? ["true", "false"] : null,
            AllowFreeform = true,
        };
    }

    internal static object CoerceRequestPortResponse(string responseType, string? answer)
    {
        string normalizedResponseType = responseType.Trim();
        string trimmedAnswer = answer?.Trim() ?? string.Empty;

        if (IsStringResponseType(normalizedResponseType))
        {
            return trimmedAnswer;
        }

        if (IsBooleanResponseType(normalizedResponseType))
        {
            return trimmedAnswer.ToLowerInvariant() switch
            {
                "true" or "t" or "yes" or "y" or "1" => true,
                "false" or "f" or "no" or "n" or "0" => false,
                _ => throw new InvalidOperationException(
                    $"Request port response type \"{responseType}\" requires a boolean answer."),
            };
        }

        if (IsNumericResponseType(normalizedResponseType))
        {
            if (double.TryParse(trimmedAnswer, NumberStyles.Float, CultureInfo.InvariantCulture, out double numeric))
            {
                return numeric;
            }

            throw new InvalidOperationException(
                $"Request port response type \"{responseType}\" requires a numeric answer.");
        }

        if (IsJsonResponseType(normalizedResponseType))
        {
            try
            {
                return JsonDocument.Parse(trimmedAnswer).RootElement.Clone();
            }
            catch (JsonException ex)
            {
                throw new InvalidOperationException(
                    $"Request port response type \"{responseType}\" requires a valid JSON answer.",
                    ex);
            }
        }

        return trimmedAnswer;
    }

    private static async Task HandleAgentResponseUpdateAsync(
        RunTurnCommandDto command,
        AgentResponseUpdateEvent update,
        CopilotTurnExecutionState state,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<SidecarEventDto, Task> onEvent)
    {
        AgentIdentity? updateAgent = null;
        string authorName = update.ExecutorId;
        string[] handoffFunctionCalls = update.Update.Contents
            .OfType<FunctionCallContent>()
            .Select(content => content.Name)
            .Where(IsHandoffFunctionName)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        if (state.TryResolveObservedAgentForMessage(update.Update.MessageId, out AgentIdentity observedMessageAgent))
        {
            updateAgent = observedMessageAgent;
            authorName = observedMessageAgent.AgentName;
        }
        else if (AgentIdentityResolver.TryResolveObservedAgentIdentity(
            command.Pattern,
            update.ExecutorId,
            state.ActiveAgent,
            out AgentIdentity resolvedUpdateAgent))
        {
            updateAgent = resolvedUpdateAgent;
            authorName = resolvedUpdateAgent.AgentName;
        }
        else if (state.ActiveAgent is AgentIdentity activeAgent)
        {
            updateAgent = activeAgent;
            authorName = activeAgent.AgentName;
            TraceHandoff(
                command,
                $"Agent response update fell back to active agent {activeAgent.AgentName} ({activeAgent.AgentId}) for executor '{update.ExecutorId}' and message '{update.Update.MessageId ?? "<none>"}'.");
        }

        if (updateAgent.HasValue)
        {
            if (handoffFunctionCalls.Length > 0)
            {
                TraceHandoff(
                    command,
                    $"Agent response update from {updateAgent.Value.AgentName} ({updateAgent.Value.AgentId}) requested handoff via {string.Join(", ", handoffFunctionCalls)}.");
            }

            await state.EmitThinkingIfNeeded(updateAgent.Value, onEvent).ConfigureAwait(false);
        }
        else if (!string.IsNullOrEmpty(update.Update.Text) || handoffFunctionCalls.Length > 0)
        {
            TraceHandoff(
                command,
                $"Agent response update could not resolve agent for executor '{update.ExecutorId}' and message '{update.Update.MessageId ?? "<none>"}'.");
        }

        if (string.IsNullOrEmpty(update.Update.Text))
        {
            return;
        }

        string messageId = state.CreateMessageId(update.Update.MessageId);
        (string _, string currentAuthorName, string currentContent) = state.AppendDelta(
            messageId,
            authorName,
            update.Update.Text);

        await onDelta(new TurnDeltaEventDto
        {
            Type = "turn-delta",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            MessageId = messageId,
            AuthorName = currentAuthorName,
            ContentDelta = update.Update.Text,
            Content = currentContent,
        }).ConfigureAwait(false);
    }

    private static async Task EmitActivityAsync(
        RunTurnCommandDto command,
        CopilotTurnExecutionState state,
        AgentActivityEventDto activity,
        Func<SidecarEventDto, Task> onEvent)
    {
        state.ApplyEvent(activity);
        TraceHandoff(
            command,
            $"Activity emitted: {activity.ActivityType} -> {activity.AgentName ?? activity.AgentId ?? "<unknown>"}.");
        await onEvent(activity).ConfigureAwait(false);

        if (string.Equals(activity.ActivityType, "handoff", StringComparison.Ordinal)
            && !string.IsNullOrWhiteSpace(activity.AgentId)
            && !string.IsNullOrWhiteSpace(activity.AgentName))
        {
            TraceHandoff(
                command,
                $"Promoting handoff target to thinking: {activity.AgentName} ({activity.AgentId}).");
            await state.EmitThinkingIfNeeded(
                new AgentIdentity(activity.AgentId, activity.AgentName),
                onEvent).ConfigureAwait(false);
        }
    }

    internal static bool TryCreateWorkflowCheckpointSavedEvent(
        RunTurnCommandDto command,
        WorkflowEvent evt,
        out WorkflowCheckpointSavedEventDto checkpointSaved)
    {
        checkpointSaved = default!;

        if (!ShouldEnableWorkflowCheckpointing(command)
            || evt is not SuperStepCompletedEvent superStepCompleted
            || superStepCompleted.CompletionInfo?.Checkpoint is not CheckpointInfo checkpoint)
        {
            return false;
        }

        checkpointSaved = new WorkflowCheckpointSavedEventDto
        {
            Type = "workflow-checkpoint-saved",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            WorkflowSessionId = checkpoint.SessionId,
            CheckpointId = checkpoint.CheckpointId,
            StorePath = GetCheckpointStorePath(command),
            StepNumber = superStepCompleted.StepNumber,
        };
        return true;
    }

    private static bool TryCreateWorkflowDiagnosticEvent(
        RunTurnCommandDto command,
        WorkflowEvent evt,
        CopilotTurnExecutionState state,
        out WorkflowDiagnosticEventDto diagnostic)
    {
        diagnostic = default!;

        switch (evt)
        {
            case ExecutorFailedEvent executorFailed:
            {
                AgentIdentity? agent = AgentIdentityResolver.TryResolveObservedAgentIdentity(
                    command.Pattern,
                    executorFailed.ExecutorId,
                    state.ActiveAgent,
                    out AgentIdentity resolvedAgent)
                    ? resolvedAgent
                    : null;
                Exception? exception = executorFailed.Data;
                diagnostic = new WorkflowDiagnosticEventDto
                {
                    Type = "workflow-diagnostic",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    Severity = "error",
                    DiagnosticKind = "executor-failed",
                    Message = ResolveDiagnosticMessage(exception, "Executor failed."),
                    AgentId = agent?.AgentId,
                    AgentName = agent?.AgentName,
                    ExecutorId = executorFailed.ExecutorId,
                    ExceptionType = exception?.GetBaseException().GetType().Name,
                };
                return true;
            }
            case WorkflowWarningEvent workflowWarning:
                diagnostic = new WorkflowDiagnosticEventDto
                {
                    Type = "workflow-diagnostic",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    Severity = "warning",
                    DiagnosticKind = workflowWarning is SubworkflowWarningEvent
                        ? "subworkflow-warning"
                        : "workflow-warning",
                    Message = ResolveDiagnosticMessage(workflowWarning.Data as string, "Workflow warning."),
                    SubworkflowId = workflowWarning is SubworkflowWarningEvent subworkflowWarning
                        ? subworkflowWarning.SubWorkflowId
                        : null,
                };
                return true;
            case WorkflowErrorEvent workflowError:
            {
                Exception? exception = workflowError.Exception;
                diagnostic = new WorkflowDiagnosticEventDto
                {
                    Type = "workflow-diagnostic",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    Severity = "error",
                    DiagnosticKind = workflowError is SubworkflowErrorEvent
                        ? "subworkflow-error"
                        : "workflow-error",
                    Message = ResolveDiagnosticMessage(exception, "Workflow failed."),
                    SubworkflowId = workflowError is SubworkflowErrorEvent subworkflowError
                        ? subworkflowError.SubworkflowId
                        : null,
                    ExceptionType = exception?.GetBaseException().GetType().Name,
                };
                return true;
            }
            default:
                return false;
        }
    }

    private static bool TryResolveRequestPortMetadata(
        WorkflowDefinitionDto? workflow,
        RequestInfoEvent requestInfo,
        out WorkflowRequestPortMetadata? metadata)
    {
        metadata = null;
        if (workflow is null)
        {
            return false;
        }

        string portId = requestInfo.Request.PortInfo.PortId;
        WorkflowNodeDto? node = workflow.Graph.Nodes.FirstOrDefault(candidate =>
            string.Equals(candidate.Kind, "request-port", StringComparison.OrdinalIgnoreCase)
            && string.Equals(candidate.Config.PortId, portId, StringComparison.OrdinalIgnoreCase));

        if (node is null)
        {
            return false;
        }

        metadata = new WorkflowRequestPortMetadata(
            node.Id,
            string.IsNullOrWhiteSpace(node.Label) ? node.Id : node.Label,
            node.Config.PortId ?? portId,
            node.Config.RequestType ?? string.Empty,
            node.Config.ResponseType ?? string.Empty,
            string.IsNullOrWhiteSpace(node.Config.Prompt) ? null : node.Config.Prompt.Trim());
        return true;
    }

    private static string BuildRequestPortFallbackQuestion(
        WorkflowRequestPortMetadata metadata,
        RequestInfoEvent requestInfo)
    {
        if (requestInfo.Request.Data.Is<WorkflowRequestPortPromptRequest>(out WorkflowRequestPortPromptRequest? promptRequest))
        {
            string baseQuestion = $"Provide a {metadata.ResponseType} response for \"{promptRequest.NodeLabel}\".";
            if (!string.IsNullOrWhiteSpace(promptRequest.InputSummary))
            {
                return $"{baseQuestion} Current input: {promptRequest.InputSummary}";
            }

            return baseQuestion;
        }

        return $"Provide a {metadata.ResponseType} response for request port \"{metadata.NodeLabel}\" ({metadata.PortId}).";
    }

    private static bool IsStringResponseType(string responseType)
        => string.Equals(responseType, "string", StringComparison.OrdinalIgnoreCase)
           || string.Equals(responseType, "text", StringComparison.OrdinalIgnoreCase);

    private static bool IsBooleanResponseType(string responseType)
        => string.Equals(responseType, "bool", StringComparison.OrdinalIgnoreCase)
           || string.Equals(responseType, "boolean", StringComparison.OrdinalIgnoreCase);

    private static bool IsNumericResponseType(string responseType)
        => string.Equals(responseType, "number", StringComparison.OrdinalIgnoreCase)
           || string.Equals(responseType, "int", StringComparison.OrdinalIgnoreCase)
           || string.Equals(responseType, "float", StringComparison.OrdinalIgnoreCase)
           || string.Equals(responseType, "double", StringComparison.OrdinalIgnoreCase)
           || string.Equals(responseType, "decimal", StringComparison.OrdinalIgnoreCase);

    private static bool IsJsonResponseType(string responseType)
        => string.Equals(responseType, "json", StringComparison.OrdinalIgnoreCase)
           || string.Equals(responseType, "object", StringComparison.OrdinalIgnoreCase)
           || string.Equals(responseType, "array", StringComparison.OrdinalIgnoreCase);

    internal sealed record WorkflowRequestPortMetadata(
        string NodeId,
        string NodeLabel,
        string PortId,
        string RequestType,
        string ResponseType,
        string? Prompt);

    private static string ResolveDiagnosticMessage(Exception? exception, string fallback)
    {
        return ResolveDiagnosticMessage(
            exception?.GetBaseException().Message,
            fallback);
    }

    private static string ResolveDiagnosticMessage(string? message, string fallback)
    {
        return string.IsNullOrWhiteSpace(message) ? fallback : message;
    }

    private static bool IsHandoffFunctionName(string? candidate)
    {
        return !string.IsNullOrWhiteSpace(candidate)
            && candidate.StartsWith(HandoffFunctionPrefix, StringComparison.Ordinal);
    }

    private static void TraceHandoff(RunTurnCommandDto command, string message)
    {
        if (!string.Equals(command.Pattern.Mode, "handoff", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        Console.Error.WriteLine($"[aryx handoff] {message}");
    }
}
