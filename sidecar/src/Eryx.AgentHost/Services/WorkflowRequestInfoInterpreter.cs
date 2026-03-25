using System.Collections.Concurrent;
using System.Text.Json;
using Eryx.AgentHost.Contracts;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

internal static class WorkflowRequestInfoInterpreter
{
    private const string HandoffActivityType = "handoff";
    private const string ToolCallingActivityType = "tool-calling";
    private const string CodeInterpreterToolName = "code interpreter";
    private const string ImageGenerationToolName = "image generation";

    public static AgentActivityEventDto? TryCreateActivityFromRequest(
        RunTurnCommandDto command,
        RequestInfoEvent requestInfo,
        AgentIdentity? activeAgent,
        ConcurrentDictionary<string, string> toolNamesByCallId)
    {
        RequestInterpretation interpretation = InterpretRequest(command.Pattern, requestInfo);
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
        return string.Equals(command.Pattern.Mode, "handoff", StringComparison.OrdinalIgnoreCase)
            && InterpretRequest(command.Pattern, requestInfo) is UnknownRequestInterpretation;
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

    private static AgentActivityEventDto CreateToolCallingActivity(
        RunTurnCommandDto command,
        AgentIdentity activeAgent,
        ToolRequestInterpretation tool,
        ConcurrentDictionary<string, string> toolNamesByCallId)
    {
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
        PatternDefinitionDto pattern,
        RequestInfoEvent requestInfo)
    {
        if (TryGetHandoffTarget(pattern, requestInfo, out AgentIdentity handoffAgent))
        {
            return new HandoffRequestInterpretation(handoffAgent);
        }

        return TryGetToolRequestInfo(requestInfo, out string toolName, out string? toolCallId)
            ? new ToolRequestInterpretation(toolName, toolCallId)
            : new UnknownRequestInterpretation();
    }

    private static bool TryGetHandoffTarget(
        PatternDefinitionDto pattern,
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
            pattern,
            target.Id,
            target.Name);
        return !string.IsNullOrWhiteSpace(agent.AgentName);
    }

    private static bool TryGetToolRequestInfo(
        RequestInfoEvent requestInfo,
        out string toolName,
        out string? toolCallId)
    {
        return TryGetStableToolRequestInfo(requestInfo.Request.Data, out toolName, out toolCallId)
            || TryGetEvaluationToolRequestInfo(requestInfo.Request.Data, out toolName, out toolCallId);
    }

    private static bool TryGetStableToolRequestInfo(
        PortableValue requestData,
        out string toolName,
        out string? toolCallId)
    {
        if (requestData.Is<FunctionCallContent>(out FunctionCallContent? functionCall))
        {
            toolName = NormalizeOptionalString(functionCall.Name) ?? "function";
            toolCallId = NormalizeOptionalString(functionCall.CallId);
            return true;
        }

        toolName = string.Empty;
        toolCallId = null;
        return false;
    }

    private static bool TryGetEvaluationToolRequestInfo(
        PortableValue requestData,
        out string toolName,
        out string? toolCallId)
    {
        if (requestData.Is<McpServerToolCallContent>(out McpServerToolCallContent? mcpToolCall))
        {
            toolName = NormalizeOptionalString(mcpToolCall.ToolName)
                ?? NormalizeOptionalString(mcpToolCall.ServerName)
                ?? string.Empty;
            toolCallId = NormalizeOptionalString(mcpToolCall.CallId);
            return toolName.Length > 0;
        }

        if (requestData.Is<CodeInterpreterToolCallContent>(out CodeInterpreterToolCallContent? codeInterpreterToolCall))
        {
            toolName = CodeInterpreterToolName;
            toolCallId = NormalizeOptionalString(codeInterpreterToolCall.CallId);
            return true;
        }

        if (requestData.Is<ImageGenerationToolCallContent>())
        {
            toolName = ImageGenerationToolName;
            toolCallId = null;
            return true;
        }

        toolName = string.Empty;
        toolCallId = null;
        return false;
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static WorkflowRequestHandoffPayload? DeserializeHandoffPayload(object handoffValue)
    {
        string json = JsonSerializer.Serialize(handoffValue, handoffValue.GetType());
        return JsonSerializer.Deserialize<WorkflowRequestHandoffPayload>(json);
    }

    private abstract record RequestInterpretation;

    private sealed record HandoffRequestInterpretation(AgentIdentity TargetAgent) : RequestInterpretation;

    private sealed record ToolRequestInterpretation(string ToolName, string? ToolCallId) : RequestInterpretation;

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
