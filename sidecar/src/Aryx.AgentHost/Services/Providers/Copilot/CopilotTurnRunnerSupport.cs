using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotTurnRunnerSupport : IProviderTurnSupport
{
    private readonly CopilotApprovalCoordinator _approvalCoordinator = new();
    private readonly CopilotUserInputCoordinator _userInputCoordinator = new();
    private readonly CopilotMcpOAuthCoordinator _mcpOAuthCoordinator = new();
    private readonly CopilotExitPlanModeCoordinator _exitPlanModeCoordinator = new();
    private readonly IProviderEventAdapter _providerEventAdapter = new CopilotEventAdapter();

    public async Task<ProviderAgentBundle> CreateAgentBundleAsync(
        RunTurnCommandDto command,
        TurnExecutionState state,
        Func<SidecarEventDto, Task> onEvent,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        CancellationTokenSource runCancellation,
        CancellationToken cancellationToken)
    {
        return await CopilotAgentBundle.CreateAsync(
                command,
                (agent, request, invocation) => _approvalCoordinator.RequestApprovalAsync(
                    command,
                    agent,
                    request,
                    invocation,
                    state.ToolNamesByCallId,
                    activity => AgentWorkflowTurnRunner.EmitActivityAsync(command, state, activity, onEvent),
                    onApproval,
                    runCancellation.Token),
                (agent, request, invocation) => _userInputCoordinator.RequestUserInputAsync(
                    command,
                    agent,
                    request,
                    invocation,
                    onUserInput,
                    runCancellation.Token),
                (agent, sessionEvent) => ObserveSessionEvent(command, state, runCancellation, agent, sessionEvent),
                cancellationToken)
            .ConfigureAwait(false);
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

    public Task<UserInputResponse> RequestRequestPortUserInputAsync(
        RunTurnCommandDto command,
        UserInputRequest request,
        Func<UserInputRequestedEventDto, Task> onUserInput,
        CancellationToken cancellationToken)
    {
        return _userInputCoordinator.RequestUserInputAsync(
            command,
            request,
            onUserInput,
            cancellationToken);
    }

    public ExitPlanModeRequestedEventDto? ConsumePendingExitPlanModeRequest(string requestId)
    {
        return _exitPlanModeCoordinator.ConsumePendingRequest(requestId);
    }

    public void ClearRequestState(string requestId)
    {
        _approvalCoordinator.ClearRequestApprovals(requestId);
    }

    private void ObserveSessionEvent(
        RunTurnCommandDto command,
        TurnExecutionState state,
        CancellationTokenSource runCancellation,
        WorkflowNodeDto agent,
        SessionEvent sessionEvent)
    {
        if (_providerEventAdapter.TryAdapt(sessionEvent) is { } providerEvent)
        {
            state.ObserveSessionEvent(agent, providerEvent);
        }

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
    }
}
