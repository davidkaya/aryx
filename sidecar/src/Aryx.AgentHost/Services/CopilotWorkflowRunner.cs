using System.Linq;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

public sealed class CopilotWorkflowRunner : ITurnWorkflowRunner
{
    private const string HandoffFunctionPrefix = "handoff_to_";
    private readonly PatternValidator _patternValidator;
    private readonly CopilotApprovalCoordinator _approvalCoordinator = new();
    private readonly CopilotUserInputCoordinator _userInputCoordinator = new();
    private readonly CopilotMcpOAuthCoordinator _mcpOAuthCoordinator = new();
    private readonly CopilotExitPlanModeCoordinator _exitPlanModeCoordinator = new();

    public CopilotWorkflowRunner(PatternValidator patternValidator)
    {
        _patternValidator = patternValidator;
    }

    public async Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
        RunTurnCommandDto command,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<AgentActivityEventDto, Task> onActivity,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        Func<McpOauthRequiredEventDto, Task> onMcpOAuthRequired,
        Func<ExitPlanModeRequestedEventDto, Task> onExitPlanMode,
        CancellationToken cancellationToken)
    {
        PatternValidationIssueDto? validationError = _patternValidator.Validate(command.Pattern).FirstOrDefault();
        if (validationError is not null)
        {
            throw new InvalidOperationException(validationError.Message);
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
            Workflow workflow = bundle.BuildWorkflow(command.Pattern);
            List<ChatMessage> inputMessages = command.Messages.Select(WorkflowTranscriptProjector.ToChatMessage).ToList();

            await using StreamingRun run = await InProcessExecution.RunStreamingAsync(workflow, inputMessages).ConfigureAwait(false);
            await run.TrySendMessageAsync(new TurnToken(emitEvents: true)).ConfigureAwait(false);

            await foreach (WorkflowEvent evt in run.WatchStreamAsync(runCancellation.Token).ConfigureAwait(false))
            {
                bool shouldEndTurn = await HandleWorkflowEventAsync(command, evt, inputMessages, state, onDelta, onActivity)
                    .ConfigureAwait(false);
                await EmitPendingActivityEventsAsync(state, onActivity).ConfigureAwait(false);
                await EmitPendingMcpOauthRequestsAsync(state, onMcpOAuthRequired).ConfigureAwait(false);
                if (shouldEndTurn)
                {
                    break;
                }
            }

            await EmitPendingActivityEventsAsync(state, onActivity).ConfigureAwait(false);
            await EmitPendingMcpOauthRequestsAsync(state, onMcpOAuthRequired).ConfigureAwait(false);
            return state.FinalizeCompletedMessages();
        }
        catch (OperationCanceledException) when (runCancellation.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            await EmitPendingActivityEventsAsync(state, onActivity).ConfigureAwait(false);
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
    }

    private static async Task EmitPendingActivityEventsAsync(
        CopilotTurnExecutionState state,
        Func<AgentActivityEventDto, Task> onActivity)
    {
        foreach (AgentActivityEventDto activity in state.DrainPendingActivityEvents())
        {
            await onActivity(activity).ConfigureAwait(false);
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

    private static async Task<bool> HandleWorkflowEventAsync(
        RunTurnCommandDto command,
        WorkflowEvent evt,
        IReadOnlyList<ChatMessage> inputMessages,
        CopilotTurnExecutionState state,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<AgentActivityEventDto, Task> onActivity)
    {
        if (evt is ExecutorInvokedEvent invoked)
        {
            if (AgentIdentityResolver.TryResolveKnownAgentIdentity(
                command.Pattern,
                invoked.ExecutorId,
                out AgentIdentity invokedAgent))
            {
                TraceHandoff(command, $"Executor invoked: {invoked.ExecutorId} -> {invokedAgent.AgentName} ({invokedAgent.AgentId}).");
                await state.EmitThinkingIfNeeded(invokedAgent, onActivity).ConfigureAwait(false);
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

            await EmitActivityAsync(command, state, activity, onActivity).ConfigureAwait(false);
            return false;
        }

        if (evt is AgentResponseUpdateEvent update)
        {
            await HandleAgentResponseUpdateAsync(command, update, state, onDelta, onActivity).ConfigureAwait(false);
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

    private static async Task HandleAgentResponseUpdateAsync(
        RunTurnCommandDto command,
        AgentResponseUpdateEvent update,
        CopilotTurnExecutionState state,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<AgentActivityEventDto, Task> onActivity)
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

        if (updateAgent.HasValue)
        {
            if (handoffFunctionCalls.Length > 0)
            {
                TraceHandoff(
                    command,
                    $"Agent response update from {updateAgent.Value.AgentName} ({updateAgent.Value.AgentId}) requested handoff via {string.Join(", ", handoffFunctionCalls)}.");
            }

            await state.EmitThinkingIfNeeded(updateAgent.Value, onActivity).ConfigureAwait(false);
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
        Func<AgentActivityEventDto, Task> onActivity)
    {
        state.ApplyActivity(activity);
        TraceHandoff(
            command,
            $"Activity emitted: {activity.ActivityType} -> {activity.AgentName ?? activity.AgentId ?? "<unknown>"}.");
        await onActivity(activity).ConfigureAwait(false);

        if (string.Equals(activity.ActivityType, "handoff", StringComparison.Ordinal)
            && !string.IsNullOrWhiteSpace(activity.AgentId)
            && !string.IsNullOrWhiteSpace(activity.AgentName))
        {
            TraceHandoff(
                command,
                $"Promoting handoff target to thinking: {activity.AgentName} ({activity.AgentId}).");
            await state.EmitThinkingIfNeeded(
                new AgentIdentity(activity.AgentId, activity.AgentName),
                onActivity).ConfigureAwait(false);
        }
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
