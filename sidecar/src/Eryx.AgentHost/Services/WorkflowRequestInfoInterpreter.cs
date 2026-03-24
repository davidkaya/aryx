using System.Collections.Concurrent;
using Eryx.AgentHost.Contracts;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

internal static class WorkflowRequestInfoInterpreter
{
    private static readonly Type? HandoffTargetType = LoadType(
        "Microsoft.Agents.AI.Workflows.Specialized.HandoffTarget, Microsoft.Agents.AI.Workflows");

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
        if (!TryReadPortableValue(requestInfo.Request.Data, HandoffTargetType, out object? handoffTarget))
        {
            return false;
        }

        object? target = handoffTarget?.GetType().GetProperty("Target")?.GetValue(handoffTarget);
        agent = AgentIdentityResolver.ResolveAgentIdentity(
            pattern,
            GetStringProperty(target, "Id"),
            GetStringProperty(target, "Name"));
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

    private static Type? LoadType(string assemblyQualifiedName)
    {
        return Type.GetType(assemblyQualifiedName, throwOnError: false);
    }

    private static bool TryReadPortableValue(PortableValue portableValue, Type? targetType, out object? value)
    {
        value = null;
        if (targetType is null || !portableValue.IsType(targetType))
        {
            return false;
        }

        value = portableValue.AsType(targetType);
        return value is not null;
    }

    private static string? GetStringProperty(object? instance, string propertyName)
    {
        return instance?.GetType().GetProperty(propertyName)?.GetValue(instance) as string;
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
