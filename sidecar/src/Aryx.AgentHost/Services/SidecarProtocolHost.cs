using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

public sealed class SidecarProtocolHost
{
    private const string DescribeCapabilitiesCommandType = "describe-capabilities";
    private const string ValidateWorkflowCommandType = "validate-workflow";
    private const string RunTurnCommandType = "run-turn";
    private const string CancelTurnCommandType = "cancel-turn";
    private const string ResolveApprovalCommandType = "resolve-approval";
    private const string ResolveUserInputCommandType = "resolve-user-input";
    private const string ListSessionsCommandType = "list-sessions";
    private const string DeleteSessionCommandType = "delete-session";
    private const string DisconnectSessionCommandType = "disconnect-session";
    private const string GetQuotaCommandType = "get-quota";

    private readonly Func<CancellationToken, Task<SidecarCapabilitiesDto>> _capabilitiesProvider;
    private readonly WorkflowValidator _workflowValidator;
    private readonly ITurnWorkflowRunner _workflowRunner;
    private readonly IProviderSessionManager _sessionManager;
    private readonly JsonSerializerOptions _jsonOptions;
    private readonly IReadOnlyDictionary<string, Func<CommandContext, Task>> _commandHandlers;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly ConcurrentDictionary<string, Task> _inFlight = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _turnCancellations = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _turnRequestIdsBySessionId =
        new(StringComparer.Ordinal);

    public SidecarProtocolHost()
        : this(new WorkflowValidator())
    {
    }

    public SidecarProtocolHost(
        ITurnWorkflowRunner? workflowRunner = null,
        Func<CancellationToken, Task<SidecarCapabilitiesDto>>? capabilitiesProvider = null,
        IProviderSessionManager? sessionManager = null)
        : this(new WorkflowValidator(), workflowRunner, capabilitiesProvider, sessionManager)
    {
    }

    public SidecarProtocolHost(
        WorkflowValidator workflowValidator,
        ITurnWorkflowRunner? workflowRunner = null,
        Func<CancellationToken, Task<SidecarCapabilitiesDto>>? capabilitiesProvider = null,
        IProviderSessionManager? sessionManager = null)
        : this(workflowValidator, new CopilotAgentProvider(), workflowRunner, capabilitiesProvider, sessionManager)
    {
    }

    internal SidecarProtocolHost(
        WorkflowValidator workflowValidator,
        IAgentProvider agentProvider,
        ITurnWorkflowRunner? workflowRunner = null,
        Func<CancellationToken, Task<SidecarCapabilitiesDto>>? capabilitiesProvider = null,
        IProviderSessionManager? sessionManager = null)
    {
        ArgumentNullException.ThrowIfNull(workflowValidator);
        ArgumentNullException.ThrowIfNull(agentProvider);

        _workflowValidator = workflowValidator;
        _workflowRunner = workflowRunner ?? agentProvider.CreateWorkflowRunner(_workflowValidator);
        _capabilitiesProvider = capabilitiesProvider ?? agentProvider.GetCapabilitiesAsync;
        _sessionManager = sessionManager ?? agentProvider.CreateSessionManager();
        _jsonOptions = JsonSerialization.CreateWebOptions();
        _jsonOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        _jsonOptions.PropertyNameCaseInsensitive = true;
        _commandHandlers = new Dictionary<string, Func<CommandContext, Task>>(StringComparer.Ordinal)
        {
            [DescribeCapabilitiesCommandType] = HandleDescribeCapabilitiesAsync,
            [ValidateWorkflowCommandType] = HandleValidateWorkflowAsync,
            [RunTurnCommandType] = HandleRunTurnAsync,
            [CancelTurnCommandType] = HandleCancelTurnAsync,
            [ResolveApprovalCommandType] = HandleResolveApprovalAsync,
            [ResolveUserInputCommandType] = HandleResolveUserInputAsync,
            [ListSessionsCommandType] = HandleListSessionsAsync,
            [DeleteSessionCommandType] = HandleDeleteSessionAsync,
            [DisconnectSessionCommandType] = HandleDisconnectSessionAsync,
            [GetQuotaCommandType] = HandleGetQuotaAsync,
        };
    }

    public async Task RunAsync(TextReader input, TextWriter output, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            string? line = await input.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            if (line is null)
            {
                break;
            }

            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            SidecarCommandEnvelope envelope = DeserializeEnvelope(line);
            TrackInFlightRequest(
                envelope.RequestId,
                HandleCommandAsync(line, envelope, output, cancellationToken));
        }

        await Task.WhenAll(_inFlight.Values).ConfigureAwait(false);
    }

    private SidecarCommandEnvelope DeserializeEnvelope(string line)
    {
        return JsonSerializer.Deserialize<SidecarCommandEnvelope>(line, _jsonOptions)
            ?? throw new InvalidOperationException("Could not deserialize sidecar command envelope.");
    }

    private void TrackInFlightRequest(string requestId, Task task)
    {
        _inFlight[requestId] = task;
        _ = task.ContinueWith(
            _ =>
            {
                _inFlight.TryRemove(requestId, out Task? removedTask);
                return removedTask is not null;
            },
            CancellationToken.None,
            TaskContinuationOptions.None,
            TaskScheduler.Default);
    }

    private async Task HandleCommandAsync(
        string rawCommand,
        SidecarCommandEnvelope envelope,
        TextWriter output,
        CancellationToken cancellationToken)
    {
        CommandContext context = new(rawCommand, envelope, output, cancellationToken);

        try
        {
            await ExecuteCommandAsync(context).ConfigureAwait(false);
            await WriteCommandCompleteAsync(context).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            await WriteCommandErrorAsync(context, ex.Message).ConfigureAwait(false);
        }
    }

    private Task ExecuteCommandAsync(CommandContext context)
    {
        if (_commandHandlers.TryGetValue(context.Envelope.Type, out Func<CommandContext, Task>? handler))
        {
            return handler(context);
        }

        throw new NotSupportedException($"Unknown sidecar command type '{context.Envelope.Type}'.");
    }

    private async Task HandleDescribeCapabilitiesAsync(CommandContext context)
    {
        await WriteAsync(context.Output, new CapabilitiesEventDto
        {
            Type = "capabilities",
            RequestId = context.Envelope.RequestId,
            Capabilities = await _capabilitiesProvider(context.CancellationToken).ConfigureAwait(false),
        }, context.CancellationToken).ConfigureAwait(false);
    }

    private async Task HandleValidateWorkflowAsync(CommandContext context)
    {
        ValidateWorkflowCommandDto command = DeserializeCommand<ValidateWorkflowCommandDto>(context);

        await WriteAsync(context.Output, new WorkflowValidationEventDto
        {
            Type = "workflow-validation",
            RequestId = context.Envelope.RequestId,
            Issues = _workflowValidator.Validate(command.Workflow, command.WorkflowLibrary),
        }, context.CancellationToken).ConfigureAwait(false);
    }

    private async Task HandleRunTurnAsync(CommandContext context)
    {
        RunTurnCommandDto command = DeserializeCommand<RunTurnCommandDto>(context);
        using CancellationTokenSource turnCancellation =
            CancellationTokenSource.CreateLinkedTokenSource(context.CancellationToken);
        if (!_turnCancellations.TryAdd(context.Envelope.RequestId, turnCancellation))
        {
            throw new InvalidOperationException(
                $"A turn with request ID '{context.Envelope.RequestId}' is already in progress.");
        }

        RegisterTurnRequest(command.SessionId, context.Envelope.RequestId);
        try
        {
            IReadOnlyList<ChatMessageDto> messages = await _workflowRunner.RunTurnAsync(
                    command,
                    delta => WriteAsync(context.Output, delta, turnCancellation.Token),
                    evt => WriteAsync(context.Output, evt, turnCancellation.Token),
                    approval => WriteAsync(context.Output, approval, turnCancellation.Token),
                    userInput => WriteAsync(context.Output, userInput, turnCancellation.Token),
                    mcpOauth => WriteAsync(context.Output, mcpOauth, turnCancellation.Token),
                    exitPlanMode => WriteAsync(context.Output, exitPlanMode, turnCancellation.Token),
                    turnCancellation.Token)
                .ConfigureAwait(false);

            await WriteTurnCompleteAsync(
                    context.Output,
                    context.Envelope.RequestId,
                    command.SessionId,
                    messages,
                    cancelled: false,
                    context.CancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (turnCancellation.IsCancellationRequested)
        {
            await WriteTurnCompleteAsync(
                    context.Output,
                    context.Envelope.RequestId,
                    command.SessionId,
                    [],
                    cancelled: true,
                    context.CancellationToken)
                .ConfigureAwait(false);
        }
        finally
        {
            _turnCancellations.TryRemove(context.Envelope.RequestId, out _);
            UnregisterTurnRequest(command.SessionId, context.Envelope.RequestId);
        }
    }

    private Task HandleCancelTurnAsync(CommandContext context)
    {
        CancelTurnCommandDto command = DeserializeCommand<CancelTurnCommandDto>(context);
        if (_turnCancellations.TryGetValue(command.TargetRequestId, out CancellationTokenSource? turnCancellation))
        {
            try
            {
                turnCancellation.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // The turn completed between lookup and cancellation.
            }
        }

        return Task.CompletedTask;
    }

    private async Task HandleResolveApprovalAsync(CommandContext context)
    {
        ResolveApprovalCommandDto command = DeserializeCommand<ResolveApprovalCommandDto>(context);
        await _workflowRunner.ResolveApprovalAsync(command, context.CancellationToken).ConfigureAwait(false);
    }

    private async Task HandleResolveUserInputAsync(CommandContext context)
    {
        ResolveUserInputCommandDto command = DeserializeCommand<ResolveUserInputCommandDto>(context);
        await _workflowRunner.ResolveUserInputAsync(command, context.CancellationToken).ConfigureAwait(false);
    }

    private async Task HandleListSessionsAsync(CommandContext context)
    {
        ListSessionsCommandDto command = DeserializeCommand<ListSessionsCommandDto>(context);
        IReadOnlyList<CopilotSessionInfoDto> sessions = await _sessionManager.ListSessionsAsync(
            command.Filter,
            context.CancellationToken).ConfigureAwait(false);

        await WriteAsync(context.Output, new SessionsListedEventDto
        {
            Type = "sessions-listed",
            RequestId = context.Envelope.RequestId,
            Sessions = sessions,
        }, context.CancellationToken).ConfigureAwait(false);
    }

    private async Task HandleDeleteSessionAsync(CommandContext context)
    {
        DeleteSessionCommandDto command = DeserializeCommand<DeleteSessionCommandDto>(context);
        if (!string.IsNullOrWhiteSpace(command.SessionId))
        {
            CancelTurnRequestsForSession(command.SessionId);
        }

        IReadOnlyList<CopilotSessionInfoDto> deletedSessions = await _sessionManager.DeleteSessionsAsync(
            command.SessionId,
            command.CopilotSessionId,
            context.CancellationToken).ConfigureAwait(false);

        await WriteAsync(context.Output, new SessionsDeletedEventDto
        {
            Type = "sessions-deleted",
            RequestId = context.Envelope.RequestId,
            SessionId = string.IsNullOrWhiteSpace(command.SessionId) ? null : command.SessionId.Trim(),
            Sessions = deletedSessions,
        }, context.CancellationToken).ConfigureAwait(false);
    }

    private async Task HandleDisconnectSessionAsync(CommandContext context)
    {
        DisconnectSessionCommandDto command = DeserializeCommand<DisconnectSessionCommandDto>(context);
        IReadOnlyList<string> cancelledRequestIds = CancelTurnRequestsForSession(command.SessionId);

        await WriteAsync(context.Output, new SessionDisconnectedEventDto
        {
            Type = "session-disconnected",
            RequestId = context.Envelope.RequestId,
            SessionId = command.SessionId,
            CancelledRequestIds = cancelledRequestIds,
        }, context.CancellationToken).ConfigureAwait(false);
    }

    private async Task HandleGetQuotaAsync(CommandContext context)
    {
        _ = DeserializeCommand<GetQuotaCommandDto>(context);
        IReadOnlyDictionary<string, QuotaSnapshotDto> quotaSnapshots =
            await _sessionManager.GetQuotaAsync(context.CancellationToken).ConfigureAwait(false);

        await WriteAsync(context.Output, new AccountQuotaResultEventDto
        {
            Type = "quota-result",
            RequestId = context.Envelope.RequestId,
            QuotaSnapshots = quotaSnapshots.ToDictionary(
                snapshot => snapshot.Key,
                snapshot => snapshot.Value,
                StringComparer.Ordinal),
        }, context.CancellationToken).ConfigureAwait(false);
    }

    private TCommand DeserializeCommand<TCommand>(CommandContext context)
        where TCommand : SidecarCommandEnvelope
    {
        return JsonSerializer.Deserialize<TCommand>(context.RawCommand, _jsonOptions)
            ?? throw new InvalidOperationException(
                $"Could not deserialize {context.Envelope.Type} command.");
    }

    private Task WriteCommandCompleteAsync(CommandContext context)
    {
        return WriteAsync(context.Output, new CommandCompleteEventDto
        {
            Type = "command-complete",
            RequestId = context.Envelope.RequestId,
        }, context.CancellationToken);
    }

    private Task WriteTurnCompleteAsync(
        TextWriter output,
        string requestId,
        string sessionId,
        IReadOnlyList<ChatMessageDto> messages,
        bool cancelled,
        CancellationToken cancellationToken)
    {
        return WriteAsync(output, new TurnCompleteEventDto
        {
            Type = "turn-complete",
            RequestId = requestId,
            SessionId = sessionId,
            Messages = messages,
            Cancelled = cancelled,
        }, cancellationToken);
    }

    private Task WriteCommandErrorAsync(CommandContext context, string message)
    {
        return WriteAsync(context.Output, new CommandErrorEventDto
        {
            Type = "command-error",
            RequestId = context.Envelope.RequestId,
            Message = message,
        }, context.CancellationToken);
    }

    private async Task WriteAsync(TextWriter output, object payload, CancellationToken cancellationToken)
    {
        string json = JsonSerializer.Serialize(payload, _jsonOptions);
        await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await output.WriteLineAsync(json).ConfigureAwait(false);
            await output.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private void RegisterTurnRequest(string sessionId, string requestId)
    {
        if (string.IsNullOrWhiteSpace(sessionId) || string.IsNullOrWhiteSpace(requestId))
        {
            return;
        }

        ConcurrentDictionary<string, byte> requestIds = _turnRequestIdsBySessionId.GetOrAdd(
            sessionId.Trim(),
            static _ => new ConcurrentDictionary<string, byte>(StringComparer.Ordinal));
        requestIds[requestId.Trim()] = 0;
    }

    private void UnregisterTurnRequest(string sessionId, string requestId)
    {
        if (string.IsNullOrWhiteSpace(sessionId) || string.IsNullOrWhiteSpace(requestId))
        {
            return;
        }

        if (!_turnRequestIdsBySessionId.TryGetValue(sessionId.Trim(), out ConcurrentDictionary<string, byte>? requestIds))
        {
            return;
        }

        requestIds.TryRemove(requestId.Trim(), out _);
        if (requestIds.IsEmpty)
        {
            _turnRequestIdsBySessionId.TryRemove(sessionId.Trim(), out _);
        }
    }

    private IReadOnlyList<string> CancelTurnRequestsForSession(string sessionId)
    {
        if (string.IsNullOrWhiteSpace(sessionId)
            || !_turnRequestIdsBySessionId.TryGetValue(sessionId.Trim(), out ConcurrentDictionary<string, byte>? requestIds))
        {
            return [];
        }

        List<string> cancelledRequestIds = [];
        foreach (string requestId in requestIds.Keys)
        {
            if (!_turnCancellations.TryGetValue(requestId, out CancellationTokenSource? turnCancellation))
            {
                continue;
            }

            try
            {
                turnCancellation.Cancel();
                cancelledRequestIds.Add(requestId);
            }
            catch (ObjectDisposedException)
            {
            }
        }

        return cancelledRequestIds;
    }

    private sealed record CommandContext(
        string RawCommand,
        SidecarCommandEnvelope Envelope,
        TextWriter Output,
        CancellationToken CancellationToken);
}
