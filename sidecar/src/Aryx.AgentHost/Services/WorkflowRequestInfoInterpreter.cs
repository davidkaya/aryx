using System.Collections.Concurrent;
using System.Text.Json;
using Aryx.AgentHost.Contracts;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal static class WorkflowRequestInfoInterpreter
{
    private const string HandoffActivityType = "handoff";
    private const string ToolCallingActivityType = "tool-calling";
    private const string CodeInterpreterToolName = "code interpreter";
    private const string ImageGenerationToolName = "image generation";
    private const int MaxToolArgumentValueLength = 4000;
    private const string TruncatedToolArgumentValue = "[truncated]";
    private static readonly JsonSerializerOptions JsonOptions = JsonSerialization.CreateWebOptions();

    public static AgentActivityEventDto? TryCreateActivityFromRequest(
        RunTurnCommandDto command,
        RequestInfoEvent requestInfo,
        AgentIdentity? activeAgent,
        ConcurrentDictionary<string, string> toolNamesByCallId)
    {
        RequestInterpretation interpretation = InterpretRequest(command.Workflow, requestInfo);
        return interpretation switch
        {
            HandoffRequestInterpretation handoff =>
                CreateHandoffActivity(command, handoff.TargetAgent, activeAgent),
            ToolRequestInterpretation tool when activeAgent.HasValue =>
                CreateToolCallingActivity(command, activeAgent.Value, tool, toolNamesByCallId),
            _ => null,
        };
    }

    public static bool RequiresUserInputTurnBoundary(
        RunTurnCommandDto command,
        RequestInfoEvent requestInfo)
    {
        return command.Workflow.IsOrchestrationMode("handoff")
            && InterpretRequest(command.Workflow, requestInfo) is UnknownRequestInterpretation;
    }

    private static AgentActivityEventDto CreateHandoffActivity(
        RunTurnCommandDto command,
        AgentIdentity handoffAgent,
        AgentIdentity? activeAgent)
    {
        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ActivityType = HandoffActivityType,
            AgentId = handoffAgent.AgentId,
            AgentName = handoffAgent.AgentName,
            SourceAgentId = activeAgent?.AgentId,
            SourceAgentName = activeAgent?.AgentName,
        };
    }

    private static AgentActivityEventDto? CreateToolCallingActivity(
        RunTurnCommandDto command,
        AgentIdentity activeAgent,
        ToolRequestInterpretation tool,
        ConcurrentDictionary<string, string> toolNamesByCallId)
    {
        if (tool.ToolCallId is not null && toolNamesByCallId.ContainsKey(tool.ToolCallId))
        {
            return null;
        }

        TrackToolCallId(toolNamesByCallId, tool.ToolCallId, tool.ToolName);

        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ActivityType = ToolCallingActivityType,
            AgentId = activeAgent.AgentId,
            AgentName = activeAgent.AgentName,
            ToolName = tool.ToolName,
            ToolCallId = tool.ToolCallId,
            ToolArguments = tool.ToolArguments,
        };
    }

    private static void TrackToolCallId(
        ConcurrentDictionary<string, string> toolNamesByCallId,
        string? toolCallId,
        string toolName)
    {
        if (toolCallId is not null)
        {
            toolNamesByCallId[toolCallId] = toolName;
        }
    }

    private static RequestInterpretation InterpretRequest(
        WorkflowDefinitionDto workflow,
        RequestInfoEvent requestInfo)
    {
        if (TryGetHandoffTarget(workflow, requestInfo, out AgentIdentity handoffAgent))
        {
            return new HandoffRequestInterpretation(handoffAgent);
        }

        return TryGetToolRequestInfo(requestInfo, out string toolName, out string? toolCallId, out IReadOnlyDictionary<string, object?>? toolArguments)
            ? new ToolRequestInterpretation(toolName, toolCallId, toolArguments)
            : new UnknownRequestInterpretation();
    }

    private static bool TryGetHandoffTarget(
        WorkflowDefinitionDto workflow,
        RequestInfoEvent requestInfo,
        out AgentIdentity agent)
    {
        agent = default;

        object? handoffValue = requestInfo.Request.Data.As<object>();
        if (handoffValue is null)
        {
            return false;
        }

        WorkflowRequestHandoffPayload? handoffTarget = DeserializeHandoffPayload(handoffValue);
        if (handoffTarget?.Target is not WorkflowRequestHandoffAgentPayload target)
        {
            return false;
        }

        agent = AgentIdentityResolver.ResolveAgentIdentity(
            workflow,
            target.Id,
            target.Name);
        return !string.IsNullOrWhiteSpace(agent.AgentName);
    }

    private static bool TryGetToolRequestInfo(
        RequestInfoEvent requestInfo,
        out string toolName,
        out string? toolCallId,
        out IReadOnlyDictionary<string, object?>? toolArguments)
    {
        return TryGetStableToolRequestInfo(requestInfo.Request.Data, out toolName, out toolCallId, out toolArguments)
            || TryGetEvaluationToolRequestInfo(requestInfo.Request.Data, out toolName, out toolCallId, out toolArguments);
    }

    private static bool TryGetStableToolRequestInfo(
        PortableValue requestData,
        out string toolName,
        out string? toolCallId,
        out IReadOnlyDictionary<string, object?>? toolArguments)
    {
        if (requestData.Is<FunctionCallContent>(out FunctionCallContent? functionCall))
        {
            toolName = NormalizeOptionalString(functionCall.Name) ?? "function";
            toolCallId = NormalizeOptionalString(functionCall.CallId);
            toolArguments = NormalizeToolArguments(functionCall.Arguments);
            return true;
        }

        toolName = string.Empty;
        toolCallId = null;
        toolArguments = null;
        return false;
    }

    private static bool TryGetEvaluationToolRequestInfo(
        PortableValue requestData,
        out string toolName,
        out string? toolCallId,
        out IReadOnlyDictionary<string, object?>? toolArguments)
    {
        if (requestData.Is<McpServerToolCallContent>(out McpServerToolCallContent? mcpToolCall))
        {
            toolName = NormalizeOptionalString(mcpToolCall.Name)
                ?? NormalizeOptionalString(mcpToolCall.ServerName)
                ?? string.Empty;
            toolCallId = NormalizeOptionalString(mcpToolCall.CallId);
            toolArguments = NormalizeToolArguments(mcpToolCall.Arguments);
            return toolName.Length > 0;
        }

        if (requestData.Is<CodeInterpreterToolCallContent>(out CodeInterpreterToolCallContent? codeInterpreterToolCall))
        {
            toolName = CodeInterpreterToolName;
            toolCallId = NormalizeOptionalString(codeInterpreterToolCall.CallId);
            toolArguments = NormalizeCodeInterpreterToolArguments(codeInterpreterToolCall);
            return true;
        }

        if (requestData.Is<ImageGenerationToolCallContent>())
        {
            toolName = ImageGenerationToolName;
            toolCallId = null;
            toolArguments = null;
            return true;
        }

        toolName = string.Empty;
        toolCallId = null;
        toolArguments = null;
        return false;
    }

    private static IReadOnlyDictionary<string, object?>? NormalizeToolArguments(
        IEnumerable<KeyValuePair<string, object?>>? arguments)
    {
        if (arguments is null)
        {
            return null;
        }

        Dictionary<string, object?> normalized = new(StringComparer.Ordinal);
        foreach (KeyValuePair<string, object?> argument in arguments)
        {
            string? key = NormalizeOptionalString(argument.Key);
            if (key is null)
            {
                continue;
            }

            object? value = NormalizeToolArgumentValue(argument.Value);
            if (value is null)
            {
                continue;
            }

            normalized[key] = value;
        }

        return normalized.Count > 0 ? normalized : null;
    }

    private static IReadOnlyDictionary<string, object?>? NormalizeCodeInterpreterToolArguments(
        CodeInterpreterToolCallContent codeInterpreterToolCall)
    {
        IList<AIContent>? rawInputs = codeInterpreterToolCall.Inputs;
        if (rawInputs is not { Count: > 0 })
        {
            return null;
        }

        List<object?> inputs = [];
        foreach (AIContent input in rawInputs)
        {
            object? normalized = input switch
            {
                TextContent text => NormalizeToolArgumentValue(text.Text),
                _ => BuildAiContentFallbackValue(input),
            };

            if (normalized is not null)
            {
                inputs.Add(normalized);
            }
        }

        return inputs.Count > 0
            ? new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["inputs"] = inputs,
            }
            : null;
    }

    private static object? NormalizeToolArgumentValue(object? value)
    {
        return value switch
        {
            null => null,
            string text => NormalizeToolArgumentText(text),
            JsonElement element => NormalizeToolArgumentElement(element),
            bool boolean => boolean,
            byte number => number,
            sbyte number => number,
            short number => number,
            ushort number => number,
            int number => number,
            uint number => number,
            long number => number,
            ulong number => number,
            float number => number,
            double number => number,
            decimal number => number,
            AIContent content => BuildAiContentFallbackValue(content),
            IEnumerable<KeyValuePair<string, object?>> dictionary => NormalizeToolArguments(dictionary),
            IEnumerable<object?> sequence => NormalizeToolArgumentSequence(sequence),
            _ => NormalizeUnknownToolArgumentValue(value),
        };
    }

    private static object? NormalizeToolArgumentElement(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => null,
            JsonValueKind.String => NormalizeToolArgumentText(element.GetString()),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => element.Deserialize<object?>(JsonOptions),
            JsonValueKind.Object => NormalizeToolArgumentObject(element),
            JsonValueKind.Array => NormalizeToolArgumentArray(element),
            _ => NormalizeToolArgumentText(element.GetRawText()),
        };
    }

    private static IReadOnlyDictionary<string, object?>? NormalizeToolArgumentObject(JsonElement element)
    {
        Dictionary<string, object?> normalized = new(StringComparer.Ordinal);
        foreach (JsonProperty property in element.EnumerateObject())
        {
            string? key = NormalizeOptionalString(property.Name);
            if (key is null)
            {
                continue;
            }

            object? value = NormalizeToolArgumentElement(property.Value);
            if (value is not null)
            {
                normalized[key] = value;
            }
        }

        return normalized.Count > 0 ? normalized : null;
    }

    private static IReadOnlyList<object?>? NormalizeToolArgumentArray(JsonElement element)
    {
        List<object?> normalized = [];
        foreach (JsonElement item in element.EnumerateArray())
        {
            object? value = NormalizeToolArgumentElement(item);
            if (value is not null)
            {
                normalized.Add(value);
            }
        }

        return normalized.Count > 0 ? normalized : null;
    }

    private static IReadOnlyList<object?>? NormalizeToolArgumentSequence(IEnumerable<object?> sequence)
    {
        List<object?> normalized = [];
        foreach (object? item in sequence)
        {
            object? value = NormalizeToolArgumentValue(item);
            if (value is not null)
            {
                normalized.Add(value);
            }
        }

        return normalized.Count > 0 ? normalized : null;
    }

    private static object? NormalizeUnknownToolArgumentValue(object value)
    {
        string json = JsonSerializer.Serialize(value, value.GetType(), JsonOptions);
        using JsonDocument document = JsonDocument.Parse(json);
        return NormalizeToolArgumentElement(document.RootElement);
    }

    private static IReadOnlyDictionary<string, object?> BuildAiContentFallbackValue(AIContent content)
    {
        return new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["type"] = content.GetType().Name,
        };
    }

    private static string? NormalizeToolArgumentText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return value.Length > MaxToolArgumentValueLength
            ? TruncatedToolArgumentValue
            : value;
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static WorkflowRequestHandoffPayload? DeserializeHandoffPayload(object handoffValue)
    {
        string json = JsonSerializer.Serialize(handoffValue, handoffValue.GetType(), JsonOptions);
        return JsonSerializer.Deserialize<WorkflowRequestHandoffPayload>(json, JsonOptions);
    }

    private abstract record RequestInterpretation;

    private sealed record HandoffRequestInterpretation(AgentIdentity TargetAgent) : RequestInterpretation;

    private sealed record ToolRequestInterpretation(
        string ToolName,
        string? ToolCallId,
        IReadOnlyDictionary<string, object?>? ToolArguments) : RequestInterpretation;

    private sealed record UnknownRequestInterpretation : RequestInterpretation;
}

internal sealed class WorkflowRequestHandoffPayload
{
    public WorkflowRequestHandoffAgentPayload? Target { get; init; }
}

internal sealed class WorkflowRequestHandoffAgentPayload
{
    public string? Id { get; init; }

    public string? Name { get; init; }
}
