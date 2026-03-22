using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using GitHub.Copilot.SDK;
using Kopaya.AgentHost.Contracts;

namespace Kopaya.AgentHost.Services;

public sealed class SidecarProtocolHost
{
    private readonly Func<CancellationToken, Task<SidecarCapabilitiesDto>> _capabilitiesProvider;
    private readonly PatternValidator _patternValidator;
    private readonly ITurnWorkflowRunner _workflowRunner;
    private readonly JsonSerializerOptions _jsonOptions;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly ConcurrentDictionary<string, Task> _inFlight = new(StringComparer.Ordinal);

    public SidecarProtocolHost()
        : this(new PatternValidator())
    {
    }

    public SidecarProtocolHost(
        PatternValidator patternValidator,
        ITurnWorkflowRunner? workflowRunner = null,
        Func<CancellationToken, Task<SidecarCapabilitiesDto>>? capabilitiesProvider = null)
    {
        _patternValidator = patternValidator;
        _workflowRunner = workflowRunner ?? new CopilotWorkflowRunner(_patternValidator);
        _capabilitiesProvider = capabilitiesProvider ?? BuildCapabilitiesAsync;
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
                        Capabilities = await _capabilitiesProvider(cancellationToken).ConfigureAwait(false),
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
                        activity => WriteAsync(output, activity, cancellationToken),
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

    private static async Task<SidecarCapabilitiesDto> BuildCapabilitiesAsync(CancellationToken cancellationToken)
    {
        IReadOnlyList<SidecarModelCapabilityDto> models = [];

        try
        {
            models = await ListAvailableModelsAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"[kopaya sidecar] Failed to list available Copilot models: {exception.Message}");
        }

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
            Models = models,
        };
    }

    private static async Task<IReadOnlyList<SidecarModelCapabilityDto>> ListAvailableModelsAsync(
        CancellationToken cancellationToken)
    {
        CopilotClientOptions clientOptions = CopilotCliPathResolver.CreateClientOptions();

        await using CopilotClient client = new(clientOptions);
        await client.StartAsync(cancellationToken).ConfigureAwait(false);

        List<ModelInfo> models = await client.ListModelsAsync(cancellationToken).ConfigureAwait(false);
        return models
            .Select(model => new SidecarModelCapabilityDto
            {
                Id = model.Id,
                Name = model.Name,
                SupportedReasoningEfforts = (model.SupportedReasoningEfforts ?? [])
                    .Where(IsReasoningEffort)
                    .Distinct(StringComparer.Ordinal)
                    .ToList(),
                DefaultReasoningEffort = IsReasoningEffort(model.DefaultReasoningEffort)
                    ? model.DefaultReasoningEffort
                    : null,
            })
            .OrderBy(model => model.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool IsReasoningEffort(string? value)
    {
        return value is "low" or "medium" or "high" or "xhigh";
    }
}
