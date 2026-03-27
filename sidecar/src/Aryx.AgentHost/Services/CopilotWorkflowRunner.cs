using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

public sealed class CopilotWorkflowRunner : ITurnWorkflowRunner
{
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
                await EmitPendingMcpOauthRequestsAsync(state, onMcpOAuthRequired).ConfigureAwait(false);
                if (shouldEndTurn)
                {
                    break;
                }
            }

            await EmitPendingMcpOauthRequestsAsync(state, onMcpOAuthRequired).ConfigureAwait(false);
            return state.FinalizeCompletedMessages();
        }
        catch (OperationCanceledException) when (runCancellation.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
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
        if (evt is ExecutorInvokedEvent invoked
            && AgentIdentityResolver.TryResolveKnownAgentIdentity(
                command.Pattern,
                invoked.ExecutorId,
                out AgentIdentity invokedAgent))
        {
            await state.EmitThinkingIfNeeded(invokedAgent, onActivity).ConfigureAwait(false);
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
                return WorkflowRequestInfoInterpreter.RequiresUserInputTurnBoundary(command, requestInfo);
            }

            state.ApplyActivity(activity);
            await onActivity(activity).ConfigureAwait(false);
            return false;
        }

        if (evt is AgentResponseUpdateEvent update)
        {
            await HandleAgentResponseUpdateAsync(command, update, state, onDelta, onActivity).ConfigureAwait(false);
            return false;
        }

        if (evt is ExecutorCompletedEvent completed
            && AgentIdentityResolver.TryResolveObservedAgentIdentity(
                command.Pattern,
                completed.ExecutorId,
                state.ActiveAgent,
                out AgentIdentity completedAgent))
        {
            state.ClearActiveAgentIfMatching(completedAgent);
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
            await state.EmitThinkingIfNeeded(updateAgent.Value, onActivity).ConfigureAwait(false);
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
}
