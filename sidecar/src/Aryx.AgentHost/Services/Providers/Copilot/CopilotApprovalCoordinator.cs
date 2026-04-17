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

    private static readonly Dictionary<string, HookToolApprovalMapping> HookToolApprovals = new(StringComparer.OrdinalIgnoreCase)
    {
        ["view"] = new(ReadPermissionKind, ReadPermissionKind),
        ["show_file"] = new(ReadPermissionKind, ReadPermissionKind),
        ["read_file"] = new(ReadPermissionKind, ReadPermissionKind),
        ["glob"] = new(ReadPermissionKind, ReadPermissionKind),
        ["grep"] = new(ReadPermissionKind, ReadPermissionKind),
        ["rg"] = new(ReadPermissionKind, ReadPermissionKind),
        ["lsp"] = new(ReadPermissionKind, ReadPermissionKind),
        ["edit"] = new(WritePermissionKind, WritePermissionKind),
        ["create"] = new(WritePermissionKind, WritePermissionKind),
        ["write_file"] = new(WritePermissionKind, WritePermissionKind),
        ["apply_patch"] = new(WritePermissionKind, WritePermissionKind),
        ["bash"] = new(ShellPermissionKind, ShellPermissionKind),
        ["read_bash"] = new(ShellPermissionKind, ShellPermissionKind),
        ["write_bash"] = new(ShellPermissionKind, ShellPermissionKind),
        ["stop_bash"] = new(ShellPermissionKind, ShellPermissionKind),
        ["list_bash"] = new(ShellPermissionKind, ShellPermissionKind),
        ["powershell"] = new(ShellPermissionKind, ShellPermissionKind),
        ["read_powershell"] = new(ShellPermissionKind, ShellPermissionKind),
        ["write_powershell"] = new(ShellPermissionKind, ShellPermissionKind),
        ["stop_powershell"] = new(ShellPermissionKind, ShellPermissionKind),
        ["list_powershell"] = new(ShellPermissionKind, ShellPermissionKind),
        ["web_fetch"] = new(UrlPermissionKind, WebFetchToolName),
        ["web_search"] = new(UrlPermissionKind, WebFetchToolName),
        ["store_memory"] = new(MemoryPermissionKind, StoreMemoryToolName),
        ["remember_fact"] = new(MemoryPermissionKind, StoreMemoryToolName),
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
        WorkflowNodeDto agent,
        PermissionRequest request,
        PermissionInvocation invocation,
        ToolCallRegistry toolCalls,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        CancellationToken cancellationToken)
    {
        return await RequestApprovalAsync(
                command,
                agent,
                request,
                invocation,
                toolCalls,
                onActivity: null,
                onApproval,
                cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<PermissionRequestResult> RequestApprovalAsync(
        RunTurnCommandDto command,
        WorkflowNodeDto agent,
        PermissionRequest request,
        PermissionInvocation invocation,
        ToolCallRegistry toolCalls,
        Func<AgentActivityEventDto, Task>? onActivity,
        Func<ApprovalRequestedEventDto, Task> onApproval,
        CancellationToken cancellationToken)
    {
        ResolvedApprovalContext approval = ResolveApprovalContext(request, toolCalls, command.Tooling?.McpServers);
        string? approvalCacheKey = ResolveApprovalCacheKey(approval.ToolName, approval.ApprovalToolKey);

        AgentActivityEventDto? fileChangeActivity = BuildToolCallFileChangeActivity(command, agent, request, approval.ToolName);
        if (fileChangeActivity is not null && onActivity is not null)
        {
            await onActivity(fileChangeActivity).ConfigureAwait(false);
        }

        if (IsToolApprovedForRequest(command.RequestId, approvalCacheKey)
            || !RequiresToolCallApproval(
                command.Workflow.Settings.ApprovalPolicy,
                agent.GetAgentId(),
                approval.ToolName,
                approval.ApprovalToolKey,
                approval.McpServerApprovalKey))
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
                    approval.ToolName))
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
        WorkflowNodeDto agent,
        PermissionRequest request,
        PermissionInvocation invocation,
        string approvalId,
        string? toolName)
    {
        ResolvedApprovalContext approval = ResolveApprovalContext(request, toolName, command.Tooling?.McpServers);

        string agentId = agent.GetAgentId();
        string agentName = agent.GetAgentName();
        string? sessionId = NormalizeOptionalString(invocation.SessionId);
        string? normalizedToolName = approval.ToolName;
        string? displayToolName = normalizedToolName ?? NormalizeOptionalString(approval.ApprovalToolKey);
        string? requestedUrl = request is PermissionRequestUrl urlRequest
            ? NormalizeOptionalString(urlRequest.Url)
            : null;
        string title = displayToolName is null
            ? $"Approve {approval.PermissionKind}"
            : $"Approve {displayToolName}";
        string detail = displayToolName is null
            ? $"{agentName} requested {approval.PermissionKind} permission"
            : $"{agentName} requested {approval.PermissionKind} permission for tool \"{displayToolName}\"";

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
            AgentId = NormalizeOptionalString(agentId),
            AgentName = NormalizeOptionalString(agentName),
            ToolName = normalizedToolName,
            PermissionKind = approval.PermissionKind,
            ApprovalToolKey = NormalizeOptionalString(approval.ApprovalToolKey),
            Title = title,
            Detail = detail,
            PermissionDetail = BuildPermissionDetail(request, command.Tooling?.McpServers),
        };
    }

    internal static AgentActivityEventDto? BuildToolCallFileChangeActivity(
        RunTurnCommandDto command,
        WorkflowNodeDto agent,
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

        string agentId = agent.GetAgentId();
        string agentName = agent.GetAgentName();
        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ActivityType = ToolCallingActivityType,
            AgentId = NormalizeOptionalString(agentId),
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

    internal static PermissionDetailDto BuildPermissionDetail(
        PermissionRequest request,
        IReadOnlyList<RunTurnMcpServerConfigDto>? configuredMcpServers = null)
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
            PermissionRequestHook hook => BuildHookPermissionDetail(hook, configuredMcpServers),
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
        string? approvalToolKey = null,
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

        return !MatchesAutoApprovedTool(autoApprovedToolNames, toolName, approvalToolKey)
            && !MatchesAutoApprovedToolName(autoApprovedToolNames, mcpServerApprovalKey);
    }

    internal static bool TryGetApprovalToolName(
        PermissionRequest request,
        ToolCallRegistry? toolCalls,
        out string? toolName)
    {
        toolName = ResolveApprovalToolName(request, toolCalls);
        return toolName is not null;
    }

    internal static bool TryGetApprovalToolName(PermissionRequest request, out string? toolName)
        => TryGetApprovalToolName(request, toolCalls: null, out toolName);

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
        ToolCallRegistry? toolCalls)
    {
        return GetDirectToolName(request)
            ?? ResolveToolNameFromLookup(request, toolCalls)
            ?? GetFallbackToolName(request);
    }

    private static ResolvedApprovalContext ResolveApprovalContext(
        PermissionRequest request,
        ToolCallRegistry? toolCalls,
        IReadOnlyList<RunTurnMcpServerConfigDto>? configuredMcpServers)
    {
        return ResolveApprovalContext(
            request,
            ResolveApprovalToolName(request, toolCalls),
            configuredMcpServers);
    }

    private static ResolvedApprovalContext ResolveApprovalContext(
        PermissionRequest request,
        string? toolName,
        IReadOnlyList<RunTurnMcpServerConfigDto>? configuredMcpServers)
    {
        string? normalizedToolName = NormalizeOptionalString(toolName);
        return request switch
        {
            PermissionRequestShell => new(
                normalizedToolName,
                ShellPermissionKind,
                ShellPermissionKind,
                null),
            PermissionRequestWrite => new(
                normalizedToolName,
                WritePermissionKind,
                WritePermissionKind,
                null),
            PermissionRequestRead => new(
                normalizedToolName,
                ReadPermissionKind,
                ReadPermissionKind,
                null),
            PermissionRequestUrl => new(
                normalizedToolName,
                UrlPermissionKind,
                WebFetchToolName,
                null),
            PermissionRequestMemory => new(
                normalizedToolName,
                MemoryPermissionKind,
                StoreMemoryToolName,
                null),
            PermissionRequestMcp => new(
                normalizedToolName,
                McpPermissionKind,
                normalizedToolName,
                ResolveMcpServerApprovalKey(request, configuredMcpServers)),
            PermissionRequestCustomTool => new(
                normalizedToolName,
                CustomToolPermissionKind,
                normalizedToolName,
                null),
            PermissionRequestHook => ResolveHookApprovalContext(normalizedToolName, configuredMcpServers),
            _ => new(
                normalizedToolName,
                NormalizeOptionalString(request.Kind) ?? "tool access",
                normalizedToolName,
                ResolveMcpServerApprovalKey(request, configuredMcpServers)),
        };
    }

    private const string McpServerApprovalPrefix = "mcp_server:";

    private static string? ResolveMcpServerApprovalKey(
        PermissionRequest request,
        IReadOnlyList<RunTurnMcpServerConfigDto>? configuredMcpServers)
    {
        return request switch
        {
            PermissionRequestMcp mcp => BuildMcpServerApprovalKey(mcp.ServerName),
            PermissionRequestHook hook => ResolveHookMcpServerApprovalKey(hook.ToolName, configuredMcpServers),
            _ => null,
        };
    }

    internal static string? BuildMcpServerApprovalKey(string? serverName)
    {
        string? normalizedServerName = NormalizeOptionalString(serverName);
        return normalizedServerName is not null ? $"{McpServerApprovalPrefix}{normalizedServerName}" : null;
    }

    internal static string? ResolveHookMcpServerApprovalKey(
        string? toolName,
        IReadOnlyList<RunTurnMcpServerConfigDto>? configuredMcpServers)
        => BuildMcpServerApprovalKey(ResolveHookMcpServerName(toolName, configuredMcpServers));

    internal static string? ResolveHookMcpServerName(
        string? toolName,
        IReadOnlyList<RunTurnMcpServerConfigDto>? configuredMcpServers)
    {
        string? normalizedToolName = NormalizeOptionalString(toolName);
        if (normalizedToolName is null || configuredMcpServers is null || configuredMcpServers.Count == 0)
        {
            return null;
        }

        return configuredMcpServers
            .Select(ResolveConfiguredMcpServerName)
            .OfType<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(static serverName => serverName.Length)
            .FirstOrDefault(serverName => MatchesHookMcpServerToolName(normalizedToolName, serverName));
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
        ToolCallRegistry? toolCalls)
    {
        if (toolCalls is null)
        {
            return null;
        }

        string? toolCallId = GetToolCallId(request);
        if (toolCallId is null
            || !toolCalls.TryGetToolName(toolCallId, out string? resolvedToolName))
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
            PermissionRequestHook hook => ResolveHookApprovalToolKey(hook.ToolName),
            _ => null,
        };
    }

    internal static string? ResolveHookToolCategory(string? toolName)
    {
        return TryResolveHookToolApproval(toolName, out HookToolApprovalMapping? mapping) && mapping is not null
            ? mapping.PermissionKind
            : null;
    }

    internal static string? ResolveHookApprovalToolKey(string? toolName)
    {
        return TryResolveHookToolApproval(toolName, out HookToolApprovalMapping? mapping) && mapping is not null
            ? mapping.ApprovalToolKey
            : null;
    }

    internal static ResolvedApprovalContext ResolveHookApprovalContext(
        string? toolName,
        IReadOnlyList<RunTurnMcpServerConfigDto>? configuredMcpServers)
    {
        string? normalizedToolName = NormalizeOptionalString(toolName);
        if (normalizedToolName is null)
        {
            return new ResolvedApprovalContext(null, HookPermissionKind, null, null);
        }

        if (TryResolveHookToolApproval(normalizedToolName, out HookToolApprovalMapping? mapping) && mapping is not null)
        {
            return new ResolvedApprovalContext(
                normalizedToolName,
                mapping.PermissionKind,
                mapping.ApprovalToolKey,
                null);
        }

        string? mcpServerApprovalKey = ResolveHookMcpServerApprovalKey(normalizedToolName, configuredMcpServers);
        return mcpServerApprovalKey is not null
            ? new ResolvedApprovalContext(
                normalizedToolName,
                McpPermissionKind,
                normalizedToolName,
                mcpServerApprovalKey)
            : new ResolvedApprovalContext(
                normalizedToolName,
                HookPermissionKind,
                normalizedToolName,
                null);
    }

    private static PermissionDetailDto BuildHookPermissionDetail(
        PermissionRequestHook hook,
        IReadOnlyList<RunTurnMcpServerConfigDto>? configuredMcpServers)
    {
        string? serverName = ResolveHookMcpServerName(hook.ToolName, configuredMcpServers);
        if (serverName is null)
        {
            return new PermissionDetailDto
            {
                Kind = HookPermissionKind,
                Args = hook.ToolArgs,
                HookMessage = NormalizeOptionalString(hook.HookMessage),
            };
        }

        return new PermissionDetailDto
        {
            Kind = McpPermissionKind,
            ServerName = serverName,
            ToolTitle = ResolveHookMcpToolTitle(hook.ToolName, serverName),
            Args = hook.ToolArgs,
        };
    }

    private static string? ResolveConfiguredMcpServerName(RunTurnMcpServerConfigDto configuredServer)
        => NormalizeOptionalString(configuredServer.Name) ?? NormalizeOptionalString(configuredServer.Id);

    private static bool MatchesHookMcpServerToolName(string toolName, string serverName)
    {
        if (string.Equals(toolName, serverName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return toolName.StartsWith($"{serverName}-", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ResolveHookMcpToolTitle(string? toolName, string serverName)
    {
        string? normalizedToolName = NormalizeOptionalString(toolName);
        if (normalizedToolName is null)
        {
            return null;
        }

        string prefix = $"{serverName}-";
        if (!normalizedToolName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return normalizedToolName;
        }

        string strippedToolName = normalizedToolName[prefix.Length..];
        return string.IsNullOrWhiteSpace(strippedToolName)
            ? normalizedToolName
            : strippedToolName;
    }

    private static bool TryResolveHookToolApproval(
        string? toolName,
        out HookToolApprovalMapping? mapping)
    {
        string? normalizedToolName = NormalizeOptionalString(toolName);
        if (normalizedToolName is not null
            && HookToolApprovals.TryGetValue(normalizedToolName, out HookToolApprovalMapping? resolvedMapping))
        {
            mapping = resolvedMapping;
            return true;
        }

        mapping = null;
        return false;
    }

    private static bool MatchesAutoApprovedTool(
        IReadOnlyList<string> autoApprovedToolNames,
        string? toolName,
        string? approvalToolKey)
    {
        return MatchesAutoApprovedToolName(autoApprovedToolNames, toolName)
            || MatchesAutoApprovedToolName(autoApprovedToolNames, approvalToolKey);
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

    internal sealed record ResolvedApprovalContext(
        string? ToolName,
        string PermissionKind,
        string? ApprovalToolKey,
        string? McpServerApprovalKey);

    private sealed record HookToolApprovalMapping(
        string PermissionKind,
        string ApprovalToolKey);

    private sealed record PendingApprovalRequest(
        string RequestId,
        string SessionId,
        string ApprovalId,
        string? ApprovalCacheKey,
        TaskCompletionSource<PermissionRequestResultKind> Decision);
}
