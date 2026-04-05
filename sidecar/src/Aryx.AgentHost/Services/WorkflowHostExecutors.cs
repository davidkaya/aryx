using System.Globalization;
using System.Text.Json;
using Aryx.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class WorkflowOutputMessagesExecutor(string id = "OutputMessages")
    : Executor(id, declareCrossRunShareable: true), IResettableExecutor
{
    public const string ExecutorId = "OutputMessages";

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
    {
        return protocolBuilder.ConfigureRoutes(routeBuilder => routeBuilder
                .AddHandler<TurnToken>(static (_, _, _) => default)
                .AddHandler<ChatMessage>(YieldMessageAsync)
                .AddHandler<List<ChatMessage>>(YieldMessagesAsync)
                .AddHandler<ChatMessage[]>(YieldMessageArrayAsync)
                .AddHandler<IEnumerable<ChatMessage>>(YieldEnumerableMessagesAsync)
                .AddCatchAll(YieldCatchAllAsync))
            .YieldsOutput<List<ChatMessage>>();
    }

    private static ValueTask YieldMessageAsync(
        ChatMessage message,
        IWorkflowContext context,
        CancellationToken cancellationToken)
        => context.YieldOutputAsync(new List<ChatMessage> { message }, cancellationToken);

    private static ValueTask YieldMessagesAsync(
        List<ChatMessage> messages,
        IWorkflowContext context,
        CancellationToken cancellationToken)
        => context.YieldOutputAsync(messages, cancellationToken);

    private static ValueTask YieldMessageArrayAsync(
        ChatMessage[] messages,
        IWorkflowContext context,
        CancellationToken cancellationToken)
        => context.YieldOutputAsync(messages.ToList(), cancellationToken);

    private static ValueTask YieldEnumerableMessagesAsync(
        IEnumerable<ChatMessage> messages,
        IWorkflowContext context,
        CancellationToken cancellationToken)
        => context.YieldOutputAsync(messages.ToList(), cancellationToken);

    private static ValueTask YieldCatchAllAsync(
        PortableValue message,
        IWorkflowContext context,
        CancellationToken cancellationToken)
    {
        if (message.Is<TurnToken>())
        {
            return default;
        }

        object payload = message.As<object>() ?? WorkflowValueSerializer.CreateNullElement();
        return context.YieldOutputAsync(
            WorkflowValueSerializer.ToOutputMessages(payload),
            cancellationToken);
    }

    ValueTask IResettableExecutor.ResetAsync() => default;
}

internal sealed class WorkflowAggregateTurnMessagesExecutor(string id)
    : ChatProtocolExecutor(id, s_options, declareCrossRunShareable: true), IResettableExecutor
{
    private static readonly ChatProtocolExecutorOptions s_options = new() { AutoSendTurnToken = false };

    protected override ValueTask TakeTurnAsync(
        List<ChatMessage> messages,
        IWorkflowContext context,
        bool? emitEvents,
        CancellationToken cancellationToken = default)
        => context.SendMessageAsync(messages, cancellationToken: cancellationToken);

    ValueTask IResettableExecutor.ResetAsync() => this.ResetAsync();
}

internal sealed class WorkflowConcurrentEndExecutor : Executor, IResettableExecutor
{
    public const string ExecutorId = "ConcurrentEnd";

    private readonly int _expectedInputs;
    private readonly Func<IList<List<ChatMessage>>, List<ChatMessage>> _aggregator;
    private List<List<ChatMessage>> _allResults;
    private int _remaining;

    public WorkflowConcurrentEndExecutor(
        int expectedInputs,
        Func<IList<List<ChatMessage>>, List<ChatMessage>> aggregator)
        : base(ExecutorId)
    {
        _expectedInputs = expectedInputs;
        _aggregator = aggregator;
        _allResults = new List<List<ChatMessage>>(expectedInputs);
        _remaining = expectedInputs;
    }

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
    {
        protocolBuilder.RouteBuilder.AddHandler<List<ChatMessage>>(async (messages, context, cancellationToken) =>
        {
            bool done;
            lock (_allResults)
            {
                _allResults.Add(messages);
                done = --_remaining == 0;
            }

            if (!done)
            {
                return;
            }

            _remaining = _expectedInputs;
            List<List<ChatMessage>> results = _allResults;
            _allResults = new List<List<ChatMessage>>(_expectedInputs);
            await context.YieldOutputAsync(_aggregator(results), cancellationToken).ConfigureAwait(false);
        });

        return protocolBuilder.YieldsOutput<List<ChatMessage>>();
    }

    public ValueTask ResetAsync()
    {
        _allResults = new List<List<ChatMessage>>(_expectedInputs);
        _remaining = _expectedInputs;
        return default;
    }
}

internal sealed class WorkflowRoundRobinGroupChatHost(
    string id,
    AIAgent[] agents,
    Dictionary<AIAgent, ExecutorBinding> agentMap,
    int maximumIterations)
    : ChatProtocolExecutor(id, s_options), IResettableExecutor
{
    private static readonly ChatProtocolExecutorOptions s_options = new()
    {
        StringMessageChatRole = ChatRole.User,
        AutoSendTurnToken = false,
    };

    private readonly AIAgent[] _agents = agents;
    private readonly Dictionary<AIAgent, ExecutorBinding> _agentMap = agentMap;
    private readonly int _maximumIterations = maximumIterations;
    private int _iterationCount;
    private int _nextIndex;

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
        => base.ConfigureProtocol(protocolBuilder).YieldsOutput<List<ChatMessage>>();

    protected override async ValueTask TakeTurnAsync(
        List<ChatMessage> messages,
        IWorkflowContext context,
        bool? emitEvents,
        CancellationToken cancellationToken = default)
    {
        if (_iterationCount < _maximumIterations)
        {
            AIAgent nextAgent = _agents[_nextIndex];
            _nextIndex = (_nextIndex + 1) % _agents.Length;

            if (_agentMap.TryGetValue(nextAgent, out ExecutorBinding? executor))
            {
                _iterationCount++;
                await context.SendMessageAsync(messages, executor.Id, cancellationToken).ConfigureAwait(false);
                await context.SendMessageAsync(new TurnToken(emitEvents), executor.Id, cancellationToken).ConfigureAwait(false);
                return;
            }
        }

        _iterationCount = 0;
        _nextIndex = 0;
        await context.YieldOutputAsync(messages, cancellationToken).ConfigureAwait(false);
    }

    protected override ValueTask ResetAsync()
    {
        _iterationCount = 0;
        _nextIndex = 0;
        return base.ResetAsync();
    }

    ValueTask IResettableExecutor.ResetAsync() => this.ResetAsync();
}

internal sealed class WorkflowStateScopeCatalog
{
    public static WorkflowStateScopeCatalog Empty { get; } = new([]);

    private readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, JsonElement>> _scopes;

    public WorkflowStateScopeCatalog(IReadOnlyList<WorkflowStateScopeDto>? stateScopes)
    {
        Dictionary<string, IReadOnlyDictionary<string, JsonElement>> scopes = new(StringComparer.OrdinalIgnoreCase);
        foreach (WorkflowStateScopeDto scope in stateScopes ?? [])
        {
            string? scopeName = NormalizeOptionalString(scope.Name);
            if (scopeName is null)
            {
                continue;
            }

            Dictionary<string, JsonElement> initialValues = new(StringComparer.OrdinalIgnoreCase);
            foreach ((string key, JsonElement value) in scope.InitialValues
                ?? new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase))
            {
                string? normalizedKey = NormalizeOptionalString(key);
                if (normalizedKey is null)
                {
                    continue;
                }

                initialValues[normalizedKey] = WorkflowValueSerializer.CloneElement(value);
            }

            scopes[scopeName] = initialValues;
        }

        _scopes = scopes;
    }

    public async ValueTask<JsonElement?> ReadJsonStateAsync(
        IWorkflowContext context,
        string scopeName,
        string key,
        CancellationToken cancellationToken)
    {
        string normalizedScope = NormalizeRequired(scopeName, nameof(scopeName));
        string normalizedKey = NormalizeRequired(key, nameof(key));

        if (TryGetInitialValue(normalizedScope, normalizedKey, out JsonElement initialValue))
        {
            JsonElement value = await context.ReadOrInitStateAsync(
                normalizedKey,
                () => WorkflowValueSerializer.CloneElement(initialValue),
                normalizedScope,
                cancellationToken).ConfigureAwait(false);
            return WorkflowValueSerializer.CloneElement(value);
        }

        JsonElement? existing = await context.ReadStateAsync<JsonElement>(
            normalizedKey,
            normalizedScope,
            cancellationToken).ConfigureAwait(false);
        return existing.HasValue ? WorkflowValueSerializer.CloneElement(existing.Value) : null;
    }

    public ValueTask QueueJsonStateUpdateAsync(
        IWorkflowContext context,
        string scopeName,
        string key,
        JsonElement value,
        CancellationToken cancellationToken)
    {
        string normalizedScope = NormalizeRequired(scopeName, nameof(scopeName));
        string normalizedKey = NormalizeRequired(key, nameof(key));
        return context.QueueStateUpdateAsync(
            normalizedKey,
            WorkflowValueSerializer.CloneElement(value),
            normalizedScope,
            cancellationToken);
    }

    private bool TryGetInitialValue(string scopeName, string key, out JsonElement value)
    {
        value = default;
        return _scopes.TryGetValue(scopeName, out IReadOnlyDictionary<string, JsonElement>? scope)
            && scope.TryGetValue(key, out value);
    }

    private static string NormalizeRequired(string value, string paramName)
    {
        return NormalizeOptionalString(value)
            ?? throw new InvalidOperationException($"{paramName} is required.");
    }

    private static string? NormalizeOptionalString(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

internal sealed record WorkflowRequestPortNodeDefinition(
    string NodeId,
    string NodeLabel,
    string PortId,
    string RequestType,
    string ResponseType,
    string? Prompt);

internal sealed class WorkflowRequestPortPromptRequest
{
    public string NodeId { get; init; } = string.Empty;

    public string NodeLabel { get; init; } = string.Empty;

    public string PortId { get; init; } = string.Empty;

    public string RequestType { get; init; } = string.Empty;

    public string ResponseType { get; init; } = string.Empty;

    public string? Prompt { get; init; }

    public string? InputSummary { get; init; }
}

internal sealed class WorkflowCodeExecutor(
    string id,
    string implementation,
    WorkflowStateScopeCatalog stateCatalog)
    : Executor(id, declareCrossRunShareable: true), IResettableExecutor
{
    private readonly string _implementation = implementation;
    private readonly WorkflowStateScopeCatalog _stateCatalog = stateCatalog;

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
    {
        return protocolBuilder.ConfigureRoutes(routeBuilder => routeBuilder
            .AddHandler<TurnToken>(static (_, _, _) => default)
            .AddCatchAll(HandleAsync))
            .SendsMessage<object>();
    }

    private async ValueTask HandleAsync(
        PortableValue message,
        IWorkflowContext context,
        CancellationToken cancellationToken)
    {
        object input = message.As<object>() ?? WorkflowValueSerializer.CreateNullElement();
        object result = await ExecuteAsync(input, context, cancellationToken).ConfigureAwait(false);
        await context.SendMessageAsync(result, cancellationToken: cancellationToken).ConfigureAwait(false);
    }

    private ValueTask<object> ExecuteAsync(
        object input,
        IWorkflowContext context,
        CancellationToken cancellationToken)
    {
        if (string.Equals(_implementation, "return-input", StringComparison.OrdinalIgnoreCase))
        {
            return ValueTask.FromResult(input);
        }

        if (_implementation.StartsWith("return-text:", StringComparison.OrdinalIgnoreCase))
        {
            return ValueTask.FromResult<object>(_implementation["return-text:".Length..]);
        }

        if (_implementation.StartsWith("return-json:", StringComparison.OrdinalIgnoreCase))
        {
            string rawJson = _implementation["return-json:".Length..];
            return ValueTask.FromResult<object>(WorkflowValueSerializer.ParseJsonElement(rawJson));
        }

        if (_implementation.StartsWith("state:set:", StringComparison.OrdinalIgnoreCase))
        {
            return ExecuteStateSetAsync(
                _implementation.Split(':', 5),
                context,
                cancellationToken);
        }

        if (_implementation.StartsWith("state:get:", StringComparison.OrdinalIgnoreCase))
        {
            return ExecuteStateGetAsync(
                _implementation.Split(':', 4),
                context,
                cancellationToken);
        }

        throw new InvalidOperationException(
            $"Code executor \"{Id}\" does not support implementation \"{_implementation}\". " +
            "Supported implementations are return-input, return-text:<text>, return-json:<json>, state:set:<scope>:<key>:<json>, and state:get:<scope>:<key>.");
    }

    private async ValueTask<object> ExecuteStateSetAsync(
        string[] segments,
        IWorkflowContext context,
        CancellationToken cancellationToken)
    {
        if (segments.Length != 5)
        {
            throw new InvalidOperationException(
                $"Code executor \"{Id}\" requires the format state:set:<scope>:<key>:<json>. Received \"{_implementation}\".");
        }

        JsonElement value = WorkflowValueSerializer.ParseJsonElement(segments[4]);
        await _stateCatalog.QueueJsonStateUpdateAsync(
            context,
            segments[2],
            segments[3],
            value,
            cancellationToken).ConfigureAwait(false);
        return value;
    }

    private async ValueTask<object> ExecuteStateGetAsync(
        string[] segments,
        IWorkflowContext context,
        CancellationToken cancellationToken)
    {
        if (segments.Length != 4)
        {
            throw new InvalidOperationException(
                $"Code executor \"{Id}\" requires the format state:get:<scope>:<key>. Received \"{_implementation}\".");
        }

        JsonElement? value = await _stateCatalog.ReadJsonStateAsync(
            context,
            segments[2],
            segments[3],
            cancellationToken).ConfigureAwait(false);
        return value ?? WorkflowValueSerializer.CreateNullElement();
    }

    public ValueTask ResetAsync() => default;
}

internal sealed class WorkflowFunctionExecutor(
    string id,
    string functionRef,
    IReadOnlyDictionary<string, JsonElement>? parameters,
    WorkflowStateScopeCatalog stateCatalog)
    : Executor(id, declareCrossRunShareable: true), IResettableExecutor
{
    private readonly string _functionRef = functionRef;
    private readonly IReadOnlyDictionary<string, JsonElement> _parameters = parameters ?? new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
    private readonly WorkflowStateScopeCatalog _stateCatalog = stateCatalog;

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
    {
        return protocolBuilder.ConfigureRoutes(routeBuilder => routeBuilder
            .AddHandler<TurnToken>(static (_, _, _) => default)
            .AddCatchAll(HandleAsync))
            .SendsMessage<object>();
    }

    private async ValueTask HandleAsync(
        PortableValue message,
        IWorkflowContext context,
        CancellationToken cancellationToken)
    {
        object input = message.As<object>() ?? WorkflowValueSerializer.CreateNullElement();
        object result = await WorkflowFunctionRegistry.InvokeAsync(
            _functionRef,
            input,
            _parameters,
            context,
            _stateCatalog,
            cancellationToken).ConfigureAwait(false);
        await context.SendMessageAsync(result, cancellationToken: cancellationToken).ConfigureAwait(false);
    }

    public ValueTask ResetAsync() => default;
}

internal static class WorkflowFunctionRegistry
{
    private static readonly HashSet<string> SupportedFunctionRefs = new(StringComparer.OrdinalIgnoreCase)
    {
        "identity",
        "return-parameter",
        "concat-text",
        "state:get",
        "state:set",
    };

    public static bool IsSupported(string? functionRef)
        => !string.IsNullOrWhiteSpace(functionRef) && SupportedFunctionRefs.Contains(functionRef.Trim());

    public static async ValueTask<object> InvokeAsync(
        string functionRef,
        object input,
        IReadOnlyDictionary<string, JsonElement> parameters,
        IWorkflowContext context,
        WorkflowStateScopeCatalog stateCatalog,
        CancellationToken cancellationToken)
    {
        string normalizedFunctionRef = functionRef.Trim();
        return normalizedFunctionRef switch
        {
            var value when string.Equals(value, "identity", StringComparison.OrdinalIgnoreCase)
                => input,
            var value when string.Equals(value, "return-parameter", StringComparison.OrdinalIgnoreCase)
                => ReturnParameter(parameters),
            var value when string.Equals(value, "concat-text", StringComparison.OrdinalIgnoreCase)
                => ConcatText(input, parameters),
            var value when string.Equals(value, "state:get", StringComparison.OrdinalIgnoreCase)
                => await GetStateAsync(parameters, context, stateCatalog, cancellationToken).ConfigureAwait(false),
            var value when string.Equals(value, "state:set", StringComparison.OrdinalIgnoreCase)
                => await SetStateAsync(parameters, context, stateCatalog, cancellationToken).ConfigureAwait(false),
            _ => throw new InvalidOperationException(
                $"Function executor references unsupported functionRef \"{functionRef}\". Supported refs are: {string.Join(", ", SupportedFunctionRefs.OrderBy(static value => value, StringComparer.OrdinalIgnoreCase))}.")
        };
    }

    private static object ReturnParameter(IReadOnlyDictionary<string, JsonElement> parameters)
    {
        if (TryGetParameter(parameters, "name", out JsonElement namedParameterSelector)
            && namedParameterSelector.ValueKind == JsonValueKind.String)
        {
            string parameterName = namedParameterSelector.GetString() ?? string.Empty;
            if (TryGetParameter(parameters, parameterName, out JsonElement namedValue))
            {
                return WorkflowValueSerializer.CloneElement(namedValue);
            }

            throw new InvalidOperationException(
                $"Function executor return-parameter could not find parameter \"{parameterName}\".");
        }

        if (TryGetParameter(parameters, "value", out JsonElement value))
        {
            return WorkflowValueSerializer.CloneElement(value);
        }

        KeyValuePair<string, JsonElement>[] remaining = parameters
            .Where(static pair => !string.Equals(pair.Key, "name", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (remaining.Length == 1)
        {
            return WorkflowValueSerializer.CloneElement(remaining[0].Value);
        }

        throw new InvalidOperationException(
            "Function executor return-parameter requires either a value parameter, a name selector, or exactly one parameter value.");
    }

    private static object ConcatText(object input, IReadOnlyDictionary<string, JsonElement> parameters)
    {
        List<string> parts = [];
        if (TryGetString(parameters, "prefix", out string? prefix))
        {
            parts.Add(prefix!);
        }

        bool includeInput = !TryGetBoolean(parameters, "includeInput", out bool parsedIncludeInput) || parsedIncludeInput;
        if (includeInput)
        {
            parts.Add(WorkflowValueSerializer.ToDisplayText(input));
        }

        if (TryGetParameter(parameters, "values", out JsonElement values))
        {
            if (values.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidOperationException("Function executor concat-text requires values to be a JSON array when provided.");
            }

            foreach (JsonElement element in values.EnumerateArray())
            {
                parts.Add(WorkflowValueSerializer.ToDisplayText(element));
            }
        }

        if (TryGetString(parameters, "suffix", out string? suffix))
        {
            parts.Add(suffix!);
        }

        string separator = TryGetString(parameters, "separator", out string? parsedSeparator)
            ? parsedSeparator!
            : string.Empty;
        return string.Join(separator, parts);
    }

    private static async ValueTask<object> GetStateAsync(
        IReadOnlyDictionary<string, JsonElement> parameters,
        IWorkflowContext context,
        WorkflowStateScopeCatalog stateCatalog,
        CancellationToken cancellationToken)
    {
        string scope = GetRequiredString(parameters, "scope");
        string key = GetRequiredString(parameters, "key");
        JsonElement? value = await stateCatalog.ReadJsonStateAsync(
            context,
            scope,
            key,
            cancellationToken).ConfigureAwait(false);
        return value ?? WorkflowValueSerializer.CreateNullElement();
    }

    private static async ValueTask<object> SetStateAsync(
        IReadOnlyDictionary<string, JsonElement> parameters,
        IWorkflowContext context,
        WorkflowStateScopeCatalog stateCatalog,
        CancellationToken cancellationToken)
    {
        string scope = GetRequiredString(parameters, "scope");
        string key = GetRequiredString(parameters, "key");
        JsonElement value = GetRequiredJson(parameters, "value");
        await stateCatalog.QueueJsonStateUpdateAsync(
            context,
            scope,
            key,
            value,
            cancellationToken).ConfigureAwait(false);
        return value;
    }

    private static string GetRequiredString(IReadOnlyDictionary<string, JsonElement> parameters, string name)
    {
        if (TryGetString(parameters, name, out string? value) && !string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        throw new InvalidOperationException($"Function executor requires a non-empty string parameter \"{name}\".");
    }

    private static JsonElement GetRequiredJson(IReadOnlyDictionary<string, JsonElement> parameters, string name)
    {
        if (TryGetParameter(parameters, name, out JsonElement value))
        {
            return WorkflowValueSerializer.CloneElement(value);
        }

        throw new InvalidOperationException($"Function executor requires parameter \"{name}\".");
    }

    private static bool TryGetString(IReadOnlyDictionary<string, JsonElement> parameters, string name, out string? value)
    {
        value = null;
        if (!TryGetParameter(parameters, name, out JsonElement element))
        {
            return false;
        }

        value = element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.True => bool.TrueString,
            JsonValueKind.False => bool.FalseString,
            JsonValueKind.Number => element.ToString(),
            _ => null,
        };
        return value is not null;
    }

    private static bool TryGetBoolean(IReadOnlyDictionary<string, JsonElement> parameters, string name, out bool value)
    {
        value = false;
        if (!TryGetParameter(parameters, name, out JsonElement element))
        {
            return false;
        }

        if (element.ValueKind == JsonValueKind.True || element.ValueKind == JsonValueKind.False)
        {
            value = element.GetBoolean();
            return true;
        }

        if (element.ValueKind == JsonValueKind.String && bool.TryParse(element.GetString(), out bool parsed))
        {
            value = parsed;
            return true;
        }

        return false;
    }

    private static bool TryGetParameter(IReadOnlyDictionary<string, JsonElement> parameters, string name, out JsonElement value)
    {
        foreach ((string key, JsonElement parameterValue) in parameters)
        {
            if (string.Equals(key, name, StringComparison.OrdinalIgnoreCase))
            {
                value = parameterValue;
                return true;
            }
        }

        value = default;
        return false;
    }
}

internal sealed class WorkflowRequestPortIngressExecutor(
    WorkflowRequestPortNodeDefinition definition,
    RequestPort port)
    : Executor($"{definition.NodeId}::request-entry", declareCrossRunShareable: true), IResettableExecutor
{
    private readonly WorkflowRequestPortNodeDefinition _definition = definition;
    private readonly RequestPort _port = port;

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
    {
        return protocolBuilder.ConfigureRoutes(routeBuilder => routeBuilder
            .AddHandler<TurnToken>(static (_, _, _) => default)
            .AddCatchAll(HandleAsync))
            .SendsMessage<WorkflowRequestPortPromptRequest>();
    }

    private async ValueTask HandleAsync(
        PortableValue message,
        IWorkflowContext context,
        CancellationToken cancellationToken)
    {
        object input = message.As<object>() ?? WorkflowValueSerializer.CreateNullElement();
        WorkflowRequestPortPromptRequest request = new()
        {
            NodeId = _definition.NodeId,
            NodeLabel = _definition.NodeLabel,
            PortId = _definition.PortId,
            RequestType = _definition.RequestType,
            ResponseType = _definition.ResponseType,
            Prompt = _definition.Prompt,
            InputSummary = WorkflowValueSerializer.ToPromptSummary(input),
        };

        await context.SendMessageAsync(request, _port.Id, cancellationToken).ConfigureAwait(false);
    }

    public ValueTask ResetAsync() => default;
}

internal sealed class WorkflowRequestPortResponseExecutor(string nodeId)
    : Executor($"{nodeId}::request-exit", declareCrossRunShareable: true), IResettableExecutor
{
    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
    {
        return protocolBuilder.ConfigureRoutes(routeBuilder => routeBuilder
            .AddHandler<TurnToken>(static (_, _, _) => default)
            .AddHandler<ExternalResponse>(static (_, _, _) => default)
            .AddCatchAll(ForwardAsync))
            .SendsMessage<object>();
    }

    private static ValueTask ForwardAsync(
        PortableValue message,
        IWorkflowContext context,
        CancellationToken cancellationToken)
    {
        object payload = message.As<object>() ?? WorkflowValueSerializer.CreateNullElement();
        return context.SendMessageAsync(payload, cancellationToken: cancellationToken);
    }

    public ValueTask ResetAsync() => default;
}

internal static class WorkflowValueSerializer
{
    private static readonly JsonSerializerOptions JsonOptions = JsonSerialization.CreateWebOptions();

    public static JsonElement CloneElement(JsonElement value) => value.Clone();

    public static JsonElement ParseJsonElement(string json)
    {
        try
        {
            return JsonDocument.Parse(json).RootElement.Clone();
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Invalid JSON payload: {ex.Message}", ex);
        }
    }

    public static JsonElement CreateNullElement() => JsonDocument.Parse("null").RootElement.Clone();

    public static List<ChatMessage> ToOutputMessages(object value)
    {
        if (value is List<ChatMessage> chatMessages)
        {
            return chatMessages;
        }

        if (value is ChatMessage chatMessage)
        {
            return [chatMessage];
        }

        if (value is ChatMessage[] chatMessageArray)
        {
            return [.. chatMessageArray];
        }

        if (value is IEnumerable<ChatMessage> enumerable)
        {
            return enumerable.ToList();
        }

        return [
            new ChatMessage(ChatRole.Assistant, ToDisplayText(value))
            {
                AuthorName = "Workflow",
            },
        ];
    }

    public static string ToDisplayText(object? value)
    {
        if (value is null)
        {
            return "null";
        }

        if (value is string text)
        {
            return text;
        }

        if (value is JsonElement jsonElement)
        {
            return jsonElement.ValueKind switch
            {
                JsonValueKind.String => jsonElement.GetString() ?? string.Empty,
                JsonValueKind.True => bool.TrueString,
                JsonValueKind.False => bool.FalseString,
                JsonValueKind.Number => jsonElement.ToString(),
                JsonValueKind.Null => "null",
                _ => jsonElement.GetRawText(),
            };
        }

        if (value is ChatMessage chatMessage)
        {
            return chatMessage.Text ?? string.Empty;
        }

        if (value is IEnumerable<ChatMessage> messages)
        {
            return string.Join(Environment.NewLine, messages.Select(static message => message.Text ?? string.Empty));
        }

        if (value is bool boolean)
        {
            return boolean ? bool.TrueString : bool.FalseString;
        }

        if (value is IFormattable formattable)
        {
            return formattable.ToString(null, CultureInfo.InvariantCulture);
        }

        return JsonSerializer.Serialize(value, JsonOptions);
    }

    public static string? ToPromptSummary(object? value)
    {
        if (value is null || value is JsonElement jsonElement && jsonElement.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        string summary = ToDisplayText(value);
        return string.IsNullOrWhiteSpace(summary) ? null : summary;
    }
}
