using Eryx.AgentHost.Contracts;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

public sealed class CopilotWorkflowRunner : ITurnWorkflowRunner
{
    private readonly PatternValidator _patternValidator;
    private readonly CopilotApprovalCoordinator _approvalCoordinator = new();

    public CopilotWorkflowRunner(PatternValidator patternValidator)
    {
        _patternValidator = patternValidator;
    }

    public async Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
        RunTurnCommandDto command,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<AgentActivityEventDto, Task> onActivity,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        CancellationToken cancellationToken)
    {
        PatternValidationIssueDto? validationError = _patternValidator.Validate(command.Pattern).FirstOrDefault();
        if (validationError is not null)
        {
            throw new InvalidOperationException(validationError.Message);
        }

        CopilotTurnExecutionState state = new(command);
        await using CopilotAgentBundle bundle = await CopilotAgentBundle.CreateAsync(
            command,
            (agent, request, invocation) => _approvalCoordinator.RequestApprovalAsync(
                command,
                agent,
                request,
                invocation,
                state.ToolNamesByCallId,
                onApproval,
                cancellationToken),
            (agent, sessionEvent) => state.ObserveSessionEvent(agent, sessionEvent),
            cancellationToken);
        Workflow workflow = bundle.BuildWorkflow(command.Pattern);
        List<ChatMessage> inputMessages = command.Messages.Select(WorkflowTranscriptProjector.ToChatMessage).ToList();

        await using StreamingRun run = await InProcessExecution.RunStreamingAsync(workflow, inputMessages).ConfigureAwait(false);
        await run.TrySendMessageAsync(new TurnToken(emitEvents: true)).ConfigureAwait(false);

        await foreach (WorkflowEvent evt in run.WatchStreamAsync(cancellationToken).ConfigureAwait(false))
        {
            bool shouldEndTurn = await HandleWorkflowEventAsync(command, evt, inputMessages, state, onDelta, onActivity)
                .ConfigureAwait(false);
            if (shouldEndTurn)
            {
                break;
            }
        }

        return state.FinalizeCompletedMessages();
    }

    public Task ResolveApprovalAsync(
        ResolveApprovalCommandDto command,
        CancellationToken cancellationToken)
    {
        return _approvalCoordinator.ResolveApprovalAsync(command, cancellationToken);
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
