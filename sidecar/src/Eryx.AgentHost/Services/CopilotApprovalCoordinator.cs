using System.Collections.Concurrent;
using GitHub.Copilot.SDK;
using Eryx.AgentHost.Contracts;

namespace Eryx.AgentHost.Services;

internal sealed class CopilotApprovalCoordinator
{
    private readonly ConcurrentDictionary<string, PendingApprovalRequest> _pendingApprovals = new(StringComparer.Ordinal);

    public Task ResolveApprovalAsync(
        ResolveApprovalCommandDto command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (string.IsNullOrWhiteSpace(command.ApprovalId))
        {
            throw new InvalidOperationException("Approval ID is required.");
        }

        if (!_pendingApprovals.TryGetValue(command.ApprovalId, out PendingApprovalRequest? pending))
        {
            throw new InvalidOperationException($"Approval \"{command.ApprovalId}\" is not pending.");
        }

        PermissionRequestResultKind decision = command.Decision.Trim().ToLowerInvariant() switch
        {
            "approved" => PermissionRequestResultKind.Approved,
            "rejected" => PermissionRequestResultKind.DeniedInteractivelyByUser,
            _ => throw new InvalidOperationException(
                $"Unsupported approval decision \"{command.Decision}\"."),
        };

        if (!pending.Decision.TrySetResult(decision))
        {
            throw new InvalidOperationException($"Approval \"{command.ApprovalId}\" is no longer pending.");
        }

        return Task.CompletedTask;
    }

    public async Task<PermissionRequestResult> RequestApprovalAsync(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        PermissionRequest request,
        PermissionInvocation invocation,
        IReadOnlyDictionary<string, string> toolNamesByCallId,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        CancellationToken cancellationToken)
    {
        TryGetApprovalToolName(request, toolNamesByCallId, out string? toolName);

        if (!RequiresToolCallApproval(command.Pattern.ApprovalPolicy, agent.Id, toolName))
        {
            return new PermissionRequestResult
            {
                Kind = PermissionRequestResultKind.Approved,
            };
        }

        string approvalId = CreateApprovalRequestId();
        TaskCompletionSource<PermissionRequestResultKind> decisionSource =
            new(TaskCreationOptions.RunContinuationsAsynchronously);
        PendingApprovalRequest pending = new(
            command.RequestId,
            command.SessionId,
            approvalId,
            decisionSource);

        if (!_pendingApprovals.TryAdd(approvalId, pending))
        {
            throw new InvalidOperationException($"Approval \"{approvalId}\" is already pending.");
        }

        try
        {
            await onApproval(BuildPermissionApprovalEvent(command, agent, request, invocation, approvalId, toolName))
                .ConfigureAwait(false);

            using CancellationTokenRegistration registration = cancellationToken.Register(
                static state =>
                {
                    ((TaskCompletionSource<PermissionRequestResultKind>)state!)
                        .TrySetCanceled();
                },
                decisionSource);

            PermissionRequestResultKind decision = await decisionSource.Task.ConfigureAwait(false);
            return new PermissionRequestResult
            {
                Kind = decision,
            };
        }
        finally
        {
            _pendingApprovals.TryRemove(approvalId, out _);
        }
    }

    internal static ApprovalRequestedEventDto BuildPermissionApprovalEvent(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        PermissionRequest request,
        PermissionInvocation invocation,
        string approvalId,
        string? toolName)
    {
        string permissionKind = string.IsNullOrWhiteSpace(request.Kind)
            ? "tool access"
            : request.Kind.Trim();
        string agentName = string.IsNullOrWhiteSpace(agent.Name) ? agent.Id : agent.Name;
        string? sessionId = string.IsNullOrWhiteSpace(invocation.SessionId)
            ? null
            : invocation.SessionId.Trim();
        string? normalizedToolName = string.IsNullOrWhiteSpace(toolName)
            ? null
            : toolName.Trim();
        string? requestedUrl = request is PermissionRequestUrl urlRequest && !string.IsNullOrWhiteSpace(urlRequest.Url)
            ? urlRequest.Url.Trim()
            : null;
        string title = normalizedToolName is null
            ? $"Approve {permissionKind}"
            : $"Approve {normalizedToolName}";
        string detail = normalizedToolName is null
            ? $"{agentName} requested {permissionKind} permission"
            : $"{agentName} requested {permissionKind} permission for tool \"{normalizedToolName}\"";

        if (requestedUrl is not null)
        {
            detail = $"{detail} to access \"{requestedUrl}\"";
        }

        if (sessionId is not null)
        {
            detail = normalizedToolName is null
                ? $"{detail} for Copilot session {sessionId}"
                : $"{detail} in Copilot session {sessionId}";
        }

        detail = $"{detail}.";

        return new ApprovalRequestedEventDto
        {
            Type = "approval-requested",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ApprovalId = approvalId,
            ApprovalKind = "tool-call",
            AgentId = string.IsNullOrWhiteSpace(agent.Id) ? null : agent.Id,
            AgentName = string.IsNullOrWhiteSpace(agentName) ? null : agentName,
            ToolName = normalizedToolName,
            PermissionKind = permissionKind,
            Title = title,
            Detail = detail,
        };
    }

    internal static bool RequiresToolCallApproval(
        ApprovalPolicyDto? approvalPolicy,
        string agentId,
        string? toolName)
    {
        if (approvalPolicy?.Rules is null || approvalPolicy.Rules.Count == 0)
        {
            return false;
        }

        bool matchesCheckpoint = false;
        foreach (ApprovalCheckpointRuleDto rule in approvalPolicy.Rules)
        {
            if (!string.Equals(rule.Kind, "tool-call", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (rule.AgentIds.Count == 0)
            {
                matchesCheckpoint = true;
                break;
            }

            if (rule.AgentIds.Any(candidate =>
                    string.Equals(candidate, agentId, StringComparison.OrdinalIgnoreCase)))
            {
                matchesCheckpoint = true;
                break;
            }
        }

        if (!matchesCheckpoint)
        {
            return false;
        }

        if (string.IsNullOrWhiteSpace(toolName))
        {
            return true;
        }

        return !approvalPolicy.AutoApprovedToolNames.Any(candidate =>
            string.Equals(candidate, toolName, StringComparison.OrdinalIgnoreCase));
    }

    internal static bool TryGetApprovalToolName(
        PermissionRequest request,
        IReadOnlyDictionary<string, string>? toolNamesByCallId,
        out string? toolName)
    {
        toolName = request switch
        {
            PermissionRequestMcp mcp when !string.IsNullOrWhiteSpace(mcp.ToolName) => mcp.ToolName.Trim(),
            PermissionRequestCustomTool customTool when !string.IsNullOrWhiteSpace(customTool.ToolName) => customTool.ToolName.Trim(),
            PermissionRequestHook hook when !string.IsNullOrWhiteSpace(hook.ToolName) => hook.ToolName.Trim(),
            _ => null,
        };

        if (!string.IsNullOrWhiteSpace(toolName))
        {
            return true;
        }

        string? toolCallId = NormalizeOptionalString(GetStringProperty(request, "ToolCallId"));
        if (toolCallId is not null
            && toolNamesByCallId is not null
            && toolNamesByCallId.TryGetValue(toolCallId, out string? resolvedToolName)
            && !string.IsNullOrWhiteSpace(resolvedToolName))
        {
            toolName = resolvedToolName.Trim();
            return true;
        }

        toolName = request switch
        {
            PermissionRequestUrl => "web_fetch",
            _ => null,
        };

        return !string.IsNullOrWhiteSpace(toolName);
    }

    internal static bool TryGetApprovalToolName(PermissionRequest request, out string? toolName)
        => TryGetApprovalToolName(request, toolNamesByCallId: null, out toolName);

    private static string CreateApprovalRequestId()
    {
        return $"approval-{Guid.NewGuid():N}";
    }

    private static string? GetStringProperty(object? instance, string propertyName)
    {
        return instance?.GetType().GetProperty(propertyName)?.GetValue(instance) as string;
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private sealed record PendingApprovalRequest(
        string RequestId,
        string SessionId,
        string ApprovalId,
        TaskCompletionSource<PermissionRequestResultKind> Decision);
}
