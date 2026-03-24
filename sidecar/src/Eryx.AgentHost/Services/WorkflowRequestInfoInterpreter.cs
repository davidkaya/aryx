using System.Collections.Concurrent;
using System.Text.Json;
using Eryx.AgentHost.Contracts;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

internal static class WorkflowRequestInfoInterpreter
{
    public static AgentActivityEventDto? TryCreateActivityFromRequest(
        RunTurnCommandDto command,
        RequestInfoEvent requestInfo,
        AgentIdentity? activeAgent,
        ConcurrentDictionary<string, string> toolNamesByCallId)
    {
        if (TryGetHandoffTarget(command.Pattern, requestInfo, out AgentIdentity handoffAgent))
        {
            return new AgentActivityEventDto
            {
                Type = "agent-activity",
                RequestId = command.RequestId,
                SessionId = command.SessionId,
                ActivityType = "handoff",
                AgentId = handoffAgent.AgentId,
                AgentName = handoffAgent.AgentName,
                SourceAgentId = activeAgent?.AgentId,
                SourceAgentName = activeAgent?.AgentName,
            };
        }

        if (!activeAgent.HasValue
            || !TryGetToolRequestInfo(requestInfo, out string toolName, out string? toolCallId))
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(toolCallId))
        {
            toolNamesByCallId[toolCallId] = toolName;
        }

        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ActivityType = "tool-calling",
            AgentId = activeAgent.Value.AgentId,
            AgentName = activeAgent.Value.AgentName,
            ToolName = toolName,
        };
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
        if (TryGetStableToolRequestInfo(requestInfo.Request.Data, out toolName, out toolCallId))
        {
            return true;
        }

        return TryGetEvaluationToolRequestInfo(requestInfo.Request.Data, out toolName, out toolCallId);
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
            return !string.IsNullOrWhiteSpace(toolName);
        }

        if (requestData.Is<CodeInterpreterToolCallContent>(out CodeInterpreterToolCallContent? codeInterpreterToolCall))
        {
            toolName = "code interpreter";
            toolCallId = NormalizeOptionalString(codeInterpreterToolCall.CallId);
            return true;
        }

        if (requestData.Is<ImageGenerationToolCallContent>())
        {
            toolName = "image generation";
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
