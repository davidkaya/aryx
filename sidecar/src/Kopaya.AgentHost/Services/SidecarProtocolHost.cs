using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using Kopaya.AgentHost.Contracts;

namespace Kopaya.AgentHost.Services;

public sealed class SidecarProtocolHost
{
    private readonly PatternValidator _patternValidator;
    private readonly CopilotWorkflowRunner _workflowRunner;
    private readonly JsonSerializerOptions _jsonOptions;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly ConcurrentDictionary<string, Task> _inFlight = new(StringComparer.Ordinal);

    public SidecarProtocolHost()
    {
        _patternValidator = new PatternValidator();
        _workflowRunner = new CopilotWorkflowRunner(_patternValidator);
        _jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            PropertyNameCaseInsensitive = true,
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
            Task task = HandleCommandAsync(line, envelope, output, cancellationToken);
            _inFlight[envelope.RequestId] = task;
            _ = task.ContinueWith(
                _ =>
                {
                    _inFlight.TryRemove(envelope.RequestId, out Task? removedTask);
                    return removedTask is not null;
                },
                CancellationToken.None,
                TaskContinuationOptions.None,
                TaskScheduler.Default);
        }

        await Task.WhenAll(_inFlight.Values).ConfigureAwait(false);
    }

    private SidecarCommandEnvelope DeserializeEnvelope(string line)
    {
        return JsonSerializer.Deserialize<SidecarCommandEnvelope>(line, _jsonOptions)
            ?? throw new InvalidOperationException("Could not deserialize sidecar command envelope.");
    }

    private async Task HandleCommandAsync(
        string rawCommand,
        SidecarCommandEnvelope envelope,
        TextWriter output,
        CancellationToken cancellationToken)
    {
        try
        {
            switch (envelope.Type)
            {
                case "describe-capabilities":
                    await WriteAsync(output, new CapabilitiesEventDto
                    {
                        Type = "capabilities",
                        RequestId = envelope.RequestId,
                        Capabilities = BuildCapabilities(),
                    }, cancellationToken).ConfigureAwait(false);
                    break;

                case "validate-pattern":
                    ValidatePatternCommandDto validateCommand =
                        JsonSerializer.Deserialize<ValidatePatternCommandDto>(rawCommand, _jsonOptions)
                        ?? throw new InvalidOperationException("Could not deserialize validate-pattern command.");

                    await WriteAsync(output, new PatternValidationEventDto
                    {
                        Type = "pattern-validation",
                        RequestId = envelope.RequestId,
                        Issues = _patternValidator.Validate(validateCommand.Pattern),
                    }, cancellationToken).ConfigureAwait(false);
                    break;

                case "run-turn":
                    RunTurnCommandDto runTurnCommand =
                        JsonSerializer.Deserialize<RunTurnCommandDto>(rawCommand, _jsonOptions)
                        ?? throw new InvalidOperationException("Could not deserialize run-turn command.");

                    IReadOnlyList<ChatMessageDto> messages = await _workflowRunner.RunTurnAsync(
                        runTurnCommand,
                        delta => WriteAsync(output, delta, cancellationToken),
                        cancellationToken).ConfigureAwait(false);

                    await WriteAsync(output, new TurnCompleteEventDto
                    {
                        Type = "turn-complete",
                        RequestId = envelope.RequestId,
                        SessionId = runTurnCommand.SessionId,
                        Messages = messages,
                    }, cancellationToken).ConfigureAwait(false);
                    break;

                default:
                    throw new NotSupportedException($"Unknown sidecar command type '{envelope.Type}'.");
            }

            await WriteAsync(output, new CommandCompleteEventDto
            {
                Type = "command-complete",
                RequestId = envelope.RequestId,
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            await WriteAsync(output, new CommandErrorEventDto
            {
                Type = "command-error",
                RequestId = envelope.RequestId,
                Message = ex.Message,
            }, cancellationToken).ConfigureAwait(false);
        }
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

    private static SidecarCapabilitiesDto BuildCapabilities()
    {
        return new SidecarCapabilitiesDto
        {
            Modes = new Dictionary<string, SidecarModeCapabilityDto>(StringComparer.OrdinalIgnoreCase)
            {
                ["single"] = new() { Available = true },
                ["sequential"] = new() { Available = true },
                ["concurrent"] = new() { Available = true },
                ["handoff"] = new() { Available = true },
                ["group-chat"] = new() { Available = true },
                ["magentic"] = new()
                {
                    Available = false,
                    Reason = "Microsoft Agent Framework currently documents Magentic orchestration as unsupported in C#.",
                },
            },
        };
    }
}
