using System.Collections.Concurrent;
using Eryx.AgentHost.Contracts;
using Microsoft.Agents.AI.Workflows;

namespace Eryx.AgentHost.Services;

internal static class WorkflowRequestInfoInterpreter
{
    private static readonly Type? HandoffTargetType = LoadType(
        "Microsoft.Agents.AI.Workflows.Specialized.HandoffTarget, Microsoft.Agents.AI.Workflows");
    private static readonly Type? FunctionCallContentType = LoadType(
        "Microsoft.Extensions.AI.FunctionCallContent, Microsoft.Extensions.AI.Abstractions");
    private static readonly Type? McpServerToolCallContentType = LoadType(
        "Microsoft.Extensions.AI.McpServerToolCallContent, Microsoft.Extensions.AI.Abstractions");
    private static readonly Type? CodeInterpreterToolCallContentType = LoadType(
        "Microsoft.Extensions.AI.CodeInterpreterToolCallContent, Microsoft.Extensions.AI.Abstractions");
    private static readonly Type? ImageGenerationToolCallContentType = LoadType(
        "Microsoft.Extensions.AI.ImageGenerationToolCallContent, Microsoft.Extensions.AI.Abstractions");

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
        if (TryReadPortableValue(requestInfo.Request.Data, FunctionCallContentType, out object? functionCall))
        {
            toolName = GetStringProperty(functionCall, "Name") ?? "function";
            toolCallId = NormalizeOptionalString(GetStringProperty(functionCall, "CallId"));
            return true;
        }

        if (TryReadPortableValue(requestInfo.Request.Data, McpServerToolCallContentType, out object? mcpToolCall))
        {
            toolName = GetStringProperty(mcpToolCall, "ToolName")
                ?? GetStringProperty(mcpToolCall, "ServerName")
                ?? string.Empty;
            toolCallId = NormalizeOptionalString(GetStringProperty(mcpToolCall, "CallId"));
            return !string.IsNullOrWhiteSpace(toolName);
        }

        if (TryReadPortableValue(requestInfo.Request.Data, CodeInterpreterToolCallContentType, out object? codeInterpreterToolCall))
        {
            toolName = "code interpreter";
            toolCallId = NormalizeOptionalString(GetStringProperty(codeInterpreterToolCall, "CallId"));
            return true;
        }

        if (TryReadPortableValue(requestInfo.Request.Data, ImageGenerationToolCallContentType, out _))
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
