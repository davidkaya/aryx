using System.Collections.Concurrent;
using GitHub.Copilot.SDK;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotApprovalCoordinator
{
    private const string ApprovedDecision = "approved";
    private const string RejectedDecision = "rejected";
    private const string ToolCallApprovalKind = "tool-call";
    private const string StoreMemoryToolName = "store_memory";
    private const string WebFetchToolName = "web_fetch";
    private const string ShellPermissionKind = "shell";
    private const string WritePermissionKind = "write";
    private const string ReadPermissionKind = "read";
    private const string McpPermissionKind = "mcp";
    private const string UrlPermissionKind = "url";
    private const string MemoryPermissionKind = "memory";
    private const string CustomToolPermissionKind = "custom-tool";
    private const string HookPermissionKind = "hook";
    private const string ToolCallingActivityType = "tool-calling";

    private static readonly Dictionary<string, string> HookToolCategories = new(StringComparer.OrdinalIgnoreCase)
    {
        ["view"] = ReadPermissionKind,
        ["glob"] = ReadPermissionKind,
        ["grep"] = ReadPermissionKind,
        ["lsp"] = ReadPermissionKind,
        ["edit"] = WritePermissionKind,
        ["create"] = WritePermissionKind,
        ["powershell"] = ShellPermissionKind,
        ["read_powershell"] = ShellPermissionKind,
        ["write_powershell"] = ShellPermissionKind,
        ["stop_powershell"] = ShellPermissionKind,
        ["list_powershell"] = ShellPermissionKind,
        ["web_fetch"] = UrlPermissionKind,
        ["web_search"] = UrlPermissionKind,
        ["store_memory"] = MemoryPermissionKind,
    };

    private readonly ConcurrentDictionary<string, PendingApprovalRequest> _pendingApprovals = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _requestApprovedTools = new(StringComparer.Ordinal);

    public Task ResolveApprovalAsync(
        ResolveApprovalCommandDto command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        string approvalId = RequireApprovalId(command.ApprovalId);
        PendingApprovalRequest pending = GetPendingApproval(approvalId);
        PermissionRequestResultKind decision = ParseDecision(command.Decision);

        if (!pending.Decision.TrySetResult(decision))
        {
            throw new InvalidOperationException($"Approval \"{approvalId}\" is no longer pending.");
        }

        if (decision == PermissionRequestResultKind.Approved && command.AlwaysApprove)
        {
            CacheApprovedToolForRequest(pending.RequestId, pending.ApprovalCacheKey);
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
        return await RequestApprovalAsync(
                command,
                agent,
                request,
                invocation,
                toolNamesByCallId,
                onActivity: null,
                onApproval,
                cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<PermissionRequestResult> RequestApprovalAsync(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        PermissionRequest request,
        PermissionInvocation invocation,
        IReadOnlyDictionary<string, string> toolNamesByCallId,
        Func<AgentActivityEventDto, Task>? onActivity,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        CancellationToken cancellationToken)
    {
        string? toolName = ResolveApprovalToolName(request, toolNamesByCallId);
        string? autoApprovedToolName = ResolveAutoApprovedToolName(request);
        string? mcpServerApprovalKey = ResolveMcpServerApprovalKey(request);
        string? approvalCacheKey = ResolveApprovalCacheKey(toolName, autoApprovedToolName);

        AgentActivityEventDto? fileChangeActivity = BuildToolCallFileChangeActivity(command, agent, request, toolName);
        if (fileChangeActivity is not null && onActivity is not null)
        {
            await onActivity(fileChangeActivity).ConfigureAwait(false);
        }

        if (IsToolApprovedForRequest(command.RequestId, approvalCacheKey)
            || !RequiresToolCallApproval(command.Pattern.ApprovalPolicy, agent.Id, toolName, autoApprovedToolName, mcpServerApprovalKey))
        {
            return CreateApprovalResult(PermissionRequestResultKind.Approved);
        }

        PendingApprovalRequest pending = CreatePendingApproval(command, approvalCacheKey);
        if (!_pendingApprovals.TryAdd(pending.ApprovalId, pending))
        {
            throw new InvalidOperationException($"Approval \"{pending.ApprovalId}\" is already pending.");
        }

        try
        {
            await onApproval(BuildPermissionApprovalEvent(
                    command,
                    agent,
                    request,
                    invocation,
                    pending.ApprovalId,
                    toolName))
                .ConfigureAwait(false);

            using CancellationTokenRegistration registration = cancellationToken.Register(
                static state =>
                {
                    ((TaskCompletionSource<PermissionRequestResultKind>)state!)
                        .TrySetCanceled();
                },
                pending.Decision);

            PermissionRequestResultKind decision = await pending.Decision.Task.ConfigureAwait(false);
            return CreateApprovalResult(decision);
        }
        finally
        {
            _pendingApprovals.TryRemove(pending.ApprovalId, out _);
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

        if (request is PermissionRequestHook hook)
        {
            string? resolvedCategory = ResolveHookToolCategory(hook.ToolName);
            if (resolvedCategory is not null)
            {
                permissionKind = resolvedCategory;
            }
        }

        string agentName = string.IsNullOrWhiteSpace(agent.Name) ? agent.Id : agent.Name;
        string? sessionId = NormalizeOptionalString(invocation.SessionId);
        string? normalizedToolName = NormalizeOptionalString(toolName);
        string? requestedUrl = request is PermissionRequestUrl urlRequest
            ? NormalizeOptionalString(urlRequest.Url)
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
            ApprovalKind = ToolCallApprovalKind,
            AgentId = NormalizeOptionalString(agent.Id),
            AgentName = NormalizeOptionalString(agentName),
            ToolName = normalizedToolName,
            PermissionKind = permissionKind,
            Title = title,
            Detail = detail,
            PermissionDetail = BuildPermissionDetail(request),
        };
    }

    internal static AgentActivityEventDto? BuildToolCallFileChangeActivity(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto agent,
        PermissionRequest request,
        string? toolName)
    {
        if (request is not PermissionRequestWrite write)
        {
            return null;
        }

        string? filePath = NormalizeOptionalString(write.FileName);
        if (filePath is null)
        {
            return null;
        }

        string agentName = string.IsNullOrWhiteSpace(agent.Name) ? agent.Id : agent.Name;
        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ActivityType = ToolCallingActivityType,
            AgentId = NormalizeOptionalString(agent.Id),
            AgentName = NormalizeOptionalString(agentName),
            ToolName = NormalizeOptionalString(toolName),
            ToolCallId = NormalizeOptionalString(write.ToolCallId),
            FileChanges =
            [
                new ToolCallFileChangeDto
                {
                    Path = filePath,
                    Diff = NormalizeOptionalPreviewText(write.Diff),
                    NewFileContents = NormalizeOptionalPreviewText(write.NewFileContents),
                },
            ],
        };
    }

    internal static PermissionDetailDto BuildPermissionDetail(PermissionRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return request switch
        {
            PermissionRequestShell shell => new PermissionDetailDto
            {
                Kind = ShellPermissionKind,
                Intention = NormalizeOptionalString(shell.Intention),
                Command = NormalizeOptionalString(shell.FullCommandText),
                Warning = NormalizeOptionalString(shell.Warning),
                PossiblePaths = NormalizeOptionalStringList(shell.PossiblePaths),
                PossibleUrls = NormalizeOptionalStringList(shell.PossibleUrls.Select(static candidate => candidate.Url)),
                HasWriteFileRedirection = shell.HasWriteFileRedirection,
            },
            PermissionRequestWrite write => new PermissionDetailDto
            {
                Kind = WritePermissionKind,
                Intention = NormalizeOptionalString(write.Intention),
                FileName = NormalizeOptionalString(write.FileName),
                Diff = NormalizeOptionalString(write.Diff),
                NewFileContents = NormalizeOptionalString(write.NewFileContents),
            },
            PermissionRequestRead read => new PermissionDetailDto
            {
                Kind = ReadPermissionKind,
                Intention = NormalizeOptionalString(read.Intention),
                Path = NormalizeOptionalString(read.Path),
            },
            PermissionRequestMcp mcp => new PermissionDetailDto
            {
                Kind = McpPermissionKind,
                ServerName = NormalizeOptionalString(mcp.ServerName),
                ToolTitle = NormalizeOptionalString(mcp.ToolTitle),
                Args = mcp.Args,
                ReadOnly = mcp.ReadOnly,
            },
            PermissionRequestUrl url => new PermissionDetailDto
            {
                Kind = UrlPermissionKind,
                Intention = NormalizeOptionalString(url.Intention),
                Url = NormalizeOptionalString(url.Url),
            },
            PermissionRequestMemory memory => new PermissionDetailDto
            {
                Kind = MemoryPermissionKind,
                Subject = NormalizeOptionalString(memory.Subject),
                Fact = NormalizeOptionalString(memory.Fact),
                Citations = NormalizeOptionalString(memory.Citations),
            },
            PermissionRequestCustomTool customTool => new PermissionDetailDto
            {
                Kind = CustomToolPermissionKind,
                ToolDescription = NormalizeOptionalString(customTool.ToolDescription),
                Args = customTool.Args,
            },
            PermissionRequestHook hook => new PermissionDetailDto
            {
                Kind = HookPermissionKind,
                Args = hook.ToolArgs,
                HookMessage = NormalizeOptionalString(hook.HookMessage),
            },
            _ => new PermissionDetailDto
            {
                Kind = NormalizeOptionalString(request.Kind) ?? "unknown",
            },
        };
    }

    internal static bool RequiresToolCallApproval(
        ApprovalPolicyDto? approvalPolicy,
        string agentId,
        string? toolName,
        string? autoApprovedToolName = null,
        string? mcpServerApprovalKey = null)
    {
        if (approvalPolicy?.Rules is null || approvalPolicy.Rules.Count == 0)
        {
            return false;
        }

        if (!HasMatchingToolCallCheckpoint(approvalPolicy.Rules, agentId))
        {
            return false;
        }

        IReadOnlyList<string> autoApprovedToolNames = approvalPolicy.AutoApprovedToolNames;
        if (autoApprovedToolNames.Count == 0)
        {
            return true;
        }

        return !MatchesAutoApprovedTool(autoApprovedToolNames, toolName, autoApprovedToolName)
            && !MatchesAutoApprovedToolName(autoApprovedToolNames, mcpServerApprovalKey);
    }

    internal static bool TryGetApprovalToolName(
        PermissionRequest request,
        IReadOnlyDictionary<string, string>? toolNamesByCallId,
        out string? toolName)
    {
        toolName = ResolveApprovalToolName(request, toolNamesByCallId);
        return toolName is not null;
    }

    internal static bool TryGetApprovalToolName(PermissionRequest request, out string? toolName)
        => TryGetApprovalToolName(request, toolNamesByCallId: null, out toolName);

    internal void ClearRequestApprovals(string requestId)
    {
        string? normalizedRequestId = NormalizeOptionalString(requestId);
        if (normalizedRequestId is null)
        {
            return;
        }

        _requestApprovedTools.TryRemove(normalizedRequestId, out _);
    }

    private static bool HasMatchingToolCallCheckpoint(
        IReadOnlyList<ApprovalCheckpointRuleDto> rules,
        string agentId)
    {
        foreach (ApprovalCheckpointRuleDto rule in rules)
        {
            if (!string.Equals(rule.Kind, ToolCallApprovalKind, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (rule.AgentIds.Count == 0
                || rule.AgentIds.Any(candidate =>
                    string.Equals(candidate, agentId, StringComparison.OrdinalIgnoreCase)))
            {
                return true;
            }
        }

        return false;
    }

    private static PendingApprovalRequest CreatePendingApproval(
        RunTurnCommandDto command,
        string? approvalCacheKey)
    {
        return new PendingApprovalRequest(
            command.RequestId,
            command.SessionId,
            CreateApprovalRequestId(),
            NormalizeOptionalString(approvalCacheKey),
            new TaskCompletionSource<PermissionRequestResultKind>(TaskCreationOptions.RunContinuationsAsynchronously));
    }

    private static PermissionRequestResult CreateApprovalResult(PermissionRequestResultKind decision)
    {
        return new PermissionRequestResult
        {
            Kind = decision,
        };
    }

    private static string? ResolveApprovalToolName(
        PermissionRequest request,
        IReadOnlyDictionary<string, string>? toolNamesByCallId)
    {
        return GetDirectToolName(request)
            ?? ResolveToolNameFromLookup(request, toolNamesByCallId)
            ?? GetFallbackToolName(request);
    }

    private static string? ResolveAutoApprovedToolName(PermissionRequest request)
    {
        return GetFallbackToolName(request);
    }

    private const string McpServerApprovalPrefix = "mcp_server:";

    private static string? ResolveMcpServerApprovalKey(PermissionRequest request)
    {
        if (request is not PermissionRequestMcp mcp)
        {
            return null;
        }

        string? serverName = NormalizeOptionalString(mcp.ServerName);
        return serverName is not null ? $"{McpServerApprovalPrefix}{serverName}" : null;
    }

    private static string? ResolveApprovalCacheKey(
        string? toolName,
        string? autoApprovedToolName)
    {
        return NormalizeOptionalString(autoApprovedToolName)
            ?? NormalizeOptionalString(toolName);
    }

    private static string? GetDirectToolName(PermissionRequest request)
    {
        return request switch
        {
            PermissionRequestMcp mcp => NormalizeOptionalString(mcp.ToolName),
            PermissionRequestCustomTool customTool => NormalizeOptionalString(customTool.ToolName),
            PermissionRequestHook hook => NormalizeOptionalString(hook.ToolName),
            _ => null,
        };
    }

    private static string? ResolveToolNameFromLookup(
        PermissionRequest request,
        IReadOnlyDictionary<string, string>? toolNamesByCallId)
    {
        if (toolNamesByCallId is null)
        {
            return null;
        }

        string? toolCallId = GetToolCallId(request);
        if (toolCallId is null
            || !toolNamesByCallId.TryGetValue(toolCallId, out string? resolvedToolName))
        {
            return null;
        }

        return NormalizeOptionalString(resolvedToolName);
    }

    private static string? GetToolCallId(PermissionRequest request)
    {
        return request switch
        {
            PermissionRequestShell shell => NormalizeOptionalString(shell.ToolCallId),
            PermissionRequestWrite write => NormalizeOptionalString(write.ToolCallId),
            PermissionRequestRead read => NormalizeOptionalString(read.ToolCallId),
            PermissionRequestMcp mcp => NormalizeOptionalString(mcp.ToolCallId),
            PermissionRequestUrl url => NormalizeOptionalString(url.ToolCallId),
            PermissionRequestMemory memory => NormalizeOptionalString(memory.ToolCallId),
            PermissionRequestCustomTool customTool => NormalizeOptionalString(customTool.ToolCallId),
            PermissionRequestHook hook => NormalizeOptionalString(hook.ToolCallId),
            _ => null,
        };
    }

    private static string? GetFallbackToolName(PermissionRequest request)
    {
        return request switch
        {
            PermissionRequestUrl => WebFetchToolName,
            PermissionRequestShell => ShellPermissionKind,
            PermissionRequestWrite => WritePermissionKind,
            PermissionRequestRead => ReadPermissionKind,
            PermissionRequestMemory => StoreMemoryToolName,
            PermissionRequestHook hook => ResolveHookToolCategory(hook.ToolName),
            _ => null,
        };
    }

    internal static string? ResolveHookToolCategory(string? toolName)
    {
        string? normalized = NormalizeOptionalString(toolName);
        if (normalized is null)
        {
            return null;
        }

        return HookToolCategories.TryGetValue(normalized, out string? category) ? category : null;
    }

    private static bool MatchesAutoApprovedTool(
        IReadOnlyList<string> autoApprovedToolNames,
        string? toolName,
        string? autoApprovedToolName)
    {
        return MatchesAutoApprovedToolName(autoApprovedToolNames, toolName)
            || MatchesAutoApprovedToolName(autoApprovedToolNames, autoApprovedToolName);
    }

    private static bool MatchesAutoApprovedToolName(
        IReadOnlyList<string> autoApprovedToolNames,
        string? toolName)
    {
        string? normalizedToolName = NormalizeOptionalString(toolName);
        return normalizedToolName is not null
            && autoApprovedToolNames.Any(candidate =>
                string.Equals(candidate, normalizedToolName, StringComparison.OrdinalIgnoreCase));
    }

    private bool IsToolApprovedForRequest(string requestId, string? approvalCacheKey)
    {
        string? normalizedRequestId = NormalizeOptionalString(requestId);
        string? normalizedApprovalCacheKey = NormalizeOptionalString(approvalCacheKey);
        if (normalizedRequestId is null || normalizedApprovalCacheKey is null)
        {
            return false;
        }

        return _requestApprovedTools.TryGetValue(normalizedRequestId, out ConcurrentDictionary<string, byte>? approvedTools)
            && approvedTools.ContainsKey(normalizedApprovalCacheKey);
    }

    private void CacheApprovedToolForRequest(string requestId, string? approvalCacheKey)
    {
        string? normalizedRequestId = NormalizeOptionalString(requestId);
        string? normalizedApprovalCacheKey = NormalizeOptionalString(approvalCacheKey);
        if (normalizedRequestId is null || normalizedApprovalCacheKey is null)
        {
            return;
        }

        ConcurrentDictionary<string, byte> approvedTools = _requestApprovedTools.GetOrAdd(
            normalizedRequestId,
            static _ => new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase));
        approvedTools.TryAdd(normalizedApprovalCacheKey, 0);
    }

    private PendingApprovalRequest GetPendingApproval(string approvalId)
    {
        if (_pendingApprovals.TryGetValue(approvalId, out PendingApprovalRequest? pending))
        {
            return pending;
        }

        throw new InvalidOperationException($"Approval \"{approvalId}\" is not pending.");
    }

    private static string RequireApprovalId(string? approvalId)
    {
        string? normalizedApprovalId = NormalizeOptionalString(approvalId);
        return normalizedApprovalId
            ?? throw new InvalidOperationException("Approval ID is required.");
    }

    private static PermissionRequestResultKind ParseDecision(string? decision)
    {
        return NormalizeOptionalString(decision)?.ToLowerInvariant() switch
        {
            ApprovedDecision => PermissionRequestResultKind.Approved,
            RejectedDecision => PermissionRequestResultKind.DeniedInteractivelyByUser,
            _ => throw new InvalidOperationException(
                $"Unsupported approval decision \"{decision}\"."),
        };
    }

    private static string CreateApprovalRequestId()
    {
        return $"approval-{Guid.NewGuid():N}";
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static string? NormalizeOptionalPreviewText(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static IReadOnlyList<string>? NormalizeOptionalStringList(IEnumerable<string?> values)
    {
        List<string> normalized = values
            .Select(NormalizeOptionalString)
            .Where(static value => value is not null)
            .Cast<string>()
            .ToList();

        return normalized.Count > 0 ? normalized : null;
    }

    private sealed record PendingApprovalRequest(
        string RequestId,
        string SessionId,
        string ApprovalId,
        string? ApprovalCacheKey,
        TaskCompletionSource<PermissionRequestResultKind> Decision);
}
