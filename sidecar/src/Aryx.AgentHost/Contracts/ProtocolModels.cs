using System.Text.Json.Serialization;

namespace Aryx.AgentHost.Contracts;

public sealed class PatternAgentDefinitionDto
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Instructions { get; init; } = string.Empty;
    public string Model { get; init; } = string.Empty;
    public string? ReasoningEffort { get; init; }
    public PatternAgentCopilotConfigDto? Copilot { get; init; }
}

public sealed class PatternAgentCopilotConfigDto
{
    public IReadOnlyList<RunTurnCustomAgentConfigDto> CustomAgents { get; init; } = [];
    public string? Agent { get; init; }
    public IReadOnlyList<string> SkillDirectories { get; init; } = [];
    public IReadOnlyList<string> DisabledSkills { get; init; } = [];
    public RunTurnInfiniteSessionsConfigDto? InfiniteSessions { get; init; }
}

public sealed class PatternGraphPositionDto
{
    public double X { get; init; }
    public double Y { get; init; }
}

public sealed class PatternGraphNodeDto
{
    public string Id { get; init; } = string.Empty;
    public string Kind { get; init; } = string.Empty;
    public PatternGraphPositionDto Position { get; init; } = new();
    public string? AgentId { get; init; }
    public int? Order { get; init; }
}

public sealed class PatternGraphEdgeDto
{
    public string Id { get; init; } = string.Empty;
    public string Source { get; init; } = string.Empty;
    public string Target { get; init; } = string.Empty;
}

public sealed class PatternGraphDto
{
    public IReadOnlyList<PatternGraphNodeDto> Nodes { get; init; } = [];
    public IReadOnlyList<PatternGraphEdgeDto> Edges { get; init; } = [];
}

public sealed class PatternDefinitionDto
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Mode { get; init; } = string.Empty;
    public string Availability { get; init; } = "available";
    public string? UnavailabilityReason { get; init; }
    public int MaxIterations { get; init; }
    public ApprovalPolicyDto? ApprovalPolicy { get; init; }
    public IReadOnlyList<PatternAgentDefinitionDto> Agents { get; init; } = [];
    public PatternGraphDto? Graph { get; init; }
    public string CreatedAt { get; init; } = string.Empty;
    public string UpdatedAt { get; init; } = string.Empty;
}

public sealed class ApprovalPolicyDto
{
    public IReadOnlyList<ApprovalCheckpointRuleDto> Rules { get; init; } = [];
    public IReadOnlyList<string> AutoApprovedToolNames { get; init; } = [];
}

public sealed class ApprovalCheckpointRuleDto
{
    public string Kind { get; init; } = string.Empty;
    public IReadOnlyList<string> AgentIds { get; init; } = [];
}

public sealed class ChatMessageDto
{
    public string Id { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public string AuthorName { get; init; } = string.Empty;
    public string Content { get; init; } = string.Empty;
    public string CreatedAt { get; init; } = string.Empty;
    public IReadOnlyList<ChatMessageAttachmentDto> Attachments { get; init; } = [];
}

public sealed class ChatMessageAttachmentDto
{
    public string Type { get; init; } = string.Empty;
    public string? Path { get; init; }
    public string? Data { get; init; }
    public string? MimeType { get; init; }
    public string? DisplayName { get; init; }
}

public sealed class PatternValidationIssueDto
{
    public string Level { get; init; } = "error";
    public string? Field { get; init; }
    public string Message { get; init; } = string.Empty;
}

public sealed class SidecarModeCapabilityDto
{
    public bool Available { get; init; }
    public string? Reason { get; init; }
}

public sealed class SidecarModelCapabilityDto
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public IReadOnlyList<string> SupportedReasoningEfforts { get; init; } = [];
    public string? DefaultReasoningEffort { get; init; }
}

public sealed class SidecarRuntimeToolDto
{
    public string Id { get; init; } = string.Empty;
    public string Label { get; init; } = string.Empty;
    public string? Description { get; init; }
}

public sealed class SidecarConnectionDiagnosticsDto
{
    public string Status { get; init; } = "copilot-error";
    public string Summary { get; init; } = string.Empty;
    public string? Detail { get; init; }
    public string? CopilotCliPath { get; init; }
    public SidecarCopilotCliVersionDiagnosticsDto? CopilotCliVersion { get; init; }
    public SidecarCopilotAccountDiagnosticsDto? Account { get; init; }
    public string CheckedAt { get; init; } = string.Empty;
}

public sealed class SidecarCopilotCliVersionDiagnosticsDto
{
    public string Status { get; init; } = "unknown";
    public string? InstalledVersion { get; init; }
    public string? LatestVersion { get; init; }
    public string? Detail { get; init; }
}

public sealed class SidecarCopilotAccountDiagnosticsDto
{
    public bool Authenticated { get; init; }
    public string? Login { get; init; }
    public string? Host { get; init; }
    public string? AuthType { get; init; }
    public string? StatusMessage { get; init; }
    public IReadOnlyList<string>? Organizations { get; init; }
}

public sealed class SidecarCapabilitiesDto
{
    public string Runtime { get; init; } = "dotnet-maf";
    public Dictionary<string, SidecarModeCapabilityDto> Modes { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public IReadOnlyList<SidecarModelCapabilityDto> Models { get; init; } = [];
    public IReadOnlyList<SidecarRuntimeToolDto> RuntimeTools { get; init; } = [];
    public SidecarConnectionDiagnosticsDto Connection { get; init; } = new();
}

public class SidecarCommandEnvelope
{
    public string Type { get; init; } = string.Empty;
    public string RequestId { get; init; } = string.Empty;
}

public sealed class DescribeCapabilitiesCommandDto : SidecarCommandEnvelope;

public sealed class ValidatePatternCommandDto : SidecarCommandEnvelope
{
    public PatternDefinitionDto Pattern { get; init; } = new();
}

public sealed class RunTurnCommandDto : SidecarCommandEnvelope
{
    public string SessionId { get; init; } = string.Empty;
    public string ProjectPath { get; init; } = string.Empty;
    public string WorkspaceKind { get; init; } = "project";
    public string Mode { get; init; } = "interactive";
    public string MessageMode { get; init; } = "enqueue";
    public string? ProjectInstructions { get; init; }
    public PatternDefinitionDto Pattern { get; init; } = new();
    public IReadOnlyList<ChatMessageDto> Messages { get; init; } = [];
    public RunTurnToolingConfigDto? Tooling { get; init; }
}

public sealed class CancelTurnCommandDto : SidecarCommandEnvelope
{
    public string TargetRequestId { get; init; } = string.Empty;
}

public sealed class ResolveApprovalCommandDto : SidecarCommandEnvelope
{
    public string ApprovalId { get; init; } = string.Empty;
    public string Decision { get; init; } = string.Empty;
    public bool AlwaysApprove { get; init; }
}

public sealed class ResolveUserInputCommandDto : SidecarCommandEnvelope
{
    public string UserInputId { get; init; } = string.Empty;
    public string Answer { get; init; } = string.Empty;
    public bool WasFreeform { get; init; }
}

public sealed class ListSessionsCommandDto : SidecarCommandEnvelope
{
    public CopilotSessionListFilterDto? Filter { get; init; }
}

public sealed class DeleteSessionCommandDto : SidecarCommandEnvelope
{
    public string? SessionId { get; init; }
    public string? CopilotSessionId { get; init; }
}

public sealed class DisconnectSessionCommandDto : SidecarCommandEnvelope
{
    public string SessionId { get; init; } = string.Empty;
}

public sealed class GetQuotaCommandDto : SidecarCommandEnvelope;

public sealed class RunTurnToolingConfigDto
{
    public IReadOnlyList<RunTurnMcpServerConfigDto> McpServers { get; init; } = [];
    public IReadOnlyList<RunTurnLspProfileConfigDto> LspProfiles { get; init; } = [];
}

public sealed class RunTurnMcpServerConfigDto
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Transport { get; init; } = "local";
    public IReadOnlyList<string> Tools { get; init; } = [];
    public int? TimeoutMs { get; init; }
    public string? Command { get; init; }
    public IReadOnlyList<string>? Args { get; init; }
    public IReadOnlyDictionary<string, string>? Env { get; init; }
    public string? Cwd { get; init; }
    public string? Url { get; init; }
    public IReadOnlyDictionary<string, string>? Headers { get; init; }
}

public sealed class RunTurnLspProfileConfigDto
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Command { get; init; } = string.Empty;
    public IReadOnlyList<string> Args { get; init; } = [];
    public string LanguageId { get; init; } = string.Empty;
    public IReadOnlyList<string> FileExtensions { get; init; } = [];
}

public sealed class RunTurnCustomAgentConfigDto
{
    public string Name { get; init; } = string.Empty;
    public string? DisplayName { get; init; }
    public string? Description { get; init; }
    public IReadOnlyList<string>? Tools { get; init; }
    public string Prompt { get; init; } = string.Empty;
    public IReadOnlyList<RunTurnMcpServerConfigDto> McpServers { get; init; } = [];
    public bool? Infer { get; init; }
}

public sealed class RunTurnInfiniteSessionsConfigDto
{
    public bool? Enabled { get; init; }
    public double? BackgroundCompactionThreshold { get; init; }
    public double? BufferExhaustionThreshold { get; init; }
}

public sealed class CopilotSessionListFilterDto
{
    public string? Cwd { get; init; }
    public string? GitRoot { get; init; }
    public string? Repository { get; init; }
    public string? Branch { get; init; }
}

public sealed class CopilotSessionInfoDto
{
    public string CopilotSessionId { get; init; } = string.Empty;
    public bool ManagedByAryx { get; init; }
    public string? SessionId { get; init; }
    public string? AgentId { get; init; }
    public string StartTime { get; init; } = string.Empty;
    public string ModifiedTime { get; init; } = string.Empty;
    public string? Summary { get; init; }
    public bool IsRemote { get; init; }
    public string? Cwd { get; init; }
    public string? GitRoot { get; init; }
    public string? Repository { get; init; }
    public string? Branch { get; init; }
}

public abstract class SidecarEventDto
{
    public string Type { get; init; } = string.Empty;
    public string RequestId { get; init; } = string.Empty;
}

public sealed class CapabilitiesEventDto : SidecarEventDto
{
    public SidecarCapabilitiesDto Capabilities { get; init; } = new();
}

public sealed class PatternValidationEventDto : SidecarEventDto
{
    public IReadOnlyList<PatternValidationIssueDto> Issues { get; init; } = [];
}

public sealed class TurnDeltaEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string MessageId { get; init; } = string.Empty;
    public string AuthorName { get; init; } = string.Empty;
    public string ContentDelta { get; init; } = string.Empty;
    public string? Content { get; init; }
}

public sealed class TurnCompleteEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public IReadOnlyList<ChatMessageDto> Messages { get; init; } = [];
    public bool Cancelled { get; init; }
}

public sealed class AgentActivityEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string ActivityType { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string? SourceAgentId { get; init; }
    public string? SourceAgentName { get; init; }
    public string? ToolName { get; init; }
}

public sealed class SubagentEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string EventKind { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string? ToolCallId { get; init; }
    public string? CustomAgentName { get; init; }
    public string? CustomAgentDisplayName { get; init; }
    public string? CustomAgentDescription { get; init; }
    public string? Error { get; init; }
    public string? Model { get; init; }
    public double? TotalToolCalls { get; init; }
    public double? TotalTokens { get; init; }
    public double? DurationMs { get; init; }
    public IReadOnlyList<string>? Tools { get; init; }
}

public sealed class SkillInvokedEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string SkillName { get; init; } = string.Empty;
    public string Path { get; init; } = string.Empty;
    public string Content { get; init; } = string.Empty;
    public IReadOnlyList<string>? AllowedTools { get; init; }
    public string? PluginName { get; init; }
    public string? PluginVersion { get; init; }
    public string? Description { get; init; }
}

public sealed class HookLifecycleEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string HookInvocationId { get; init; } = string.Empty;
    public string HookType { get; init; } = string.Empty;
    public string Phase { get; init; } = string.Empty;
    public bool? Success { get; init; }
    public object? Input { get; init; }
    public object? Output { get; init; }
    public string? Error { get; init; }
}

public sealed class QuotaSnapshotDto
{
    public double EntitlementRequests { get; init; }
    public double UsedRequests { get; init; }
    public double RemainingPercentage { get; init; }
    public double Overage { get; init; }
    public bool OverageAllowedWithExhaustedQuota { get; init; }
    public string? ResetDate { get; init; }
}

public sealed class AccountQuotaResultEventDto : SidecarEventDto
{
    public Dictionary<string, QuotaSnapshotDto> QuotaSnapshots { get; init; } = new(StringComparer.Ordinal);
}

public sealed class AssistantUsageEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string Model { get; init; } = string.Empty;
    public double? InputTokens { get; init; }
    public double? OutputTokens { get; init; }
    public double? CacheReadTokens { get; init; }
    public double? CacheWriteTokens { get; init; }
    public double? Cost { get; init; }
    public double? Duration { get; init; }
    public double? TotalNanoAiu { get; init; }
    public Dictionary<string, QuotaSnapshotDto>? QuotaSnapshots { get; init; }
}

public sealed class SessionUsageEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public double TokenLimit { get; init; }
    public double CurrentTokens { get; init; }
    public double MessagesLength { get; init; }
    public double? SystemTokens { get; init; }
    public double? ConversationTokens { get; init; }
    public double? ToolDefinitionsTokens { get; init; }
    public bool? IsInitial { get; init; }
}

public sealed class SessionCompactionEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string Phase { get; init; } = string.Empty;
    public bool? Success { get; init; }
    public string? Error { get; init; }
    public double? SystemTokens { get; init; }
    public double? ConversationTokens { get; init; }
    public double? ToolDefinitionsTokens { get; init; }
    public double? PreCompactionTokens { get; init; }
    public double? PostCompactionTokens { get; init; }
    public double? PreCompactionMessagesLength { get; init; }
    public double? MessagesRemoved { get; init; }
    public double? TokensRemoved { get; init; }
    public string? SummaryContent { get; init; }
    public double? CheckpointNumber { get; init; }
    public string? CheckpointPath { get; init; }
}

public sealed class PendingMessagesModifiedEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
}

public sealed class SessionsListedEventDto : SidecarEventDto
{
    public IReadOnlyList<CopilotSessionInfoDto> Sessions { get; init; } = [];
}

public sealed class SessionsDeletedEventDto : SidecarEventDto
{
    public string? SessionId { get; init; }
    public IReadOnlyList<CopilotSessionInfoDto> Sessions { get; init; } = [];
}

public sealed class SessionDisconnectedEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public IReadOnlyList<string> CancelledRequestIds { get; init; } = [];
}

public sealed class PermissionDetailDto
{
    public string Kind { get; init; } = string.Empty;
    public string? Intention { get; init; }
    public string? Command { get; init; }
    public string? Warning { get; init; }
    public IReadOnlyList<string>? PossiblePaths { get; init; }
    public IReadOnlyList<string>? PossibleUrls { get; init; }
    public bool? HasWriteFileRedirection { get; init; }
    public string? FileName { get; init; }
    public string? Diff { get; init; }
    public string? NewFileContents { get; init; }
    public string? Path { get; init; }
    public string? ServerName { get; init; }
    public string? ToolTitle { get; init; }
    public object? Args { get; init; }
    public bool? ReadOnly { get; init; }
    public string? Url { get; init; }
    public string? Subject { get; init; }
    public string? Fact { get; init; }
    public string? Citations { get; init; }
    public string? ToolDescription { get; init; }
    public string? HookMessage { get; init; }
}

public sealed class ApprovalRequestedEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string ApprovalId { get; init; } = string.Empty;
    public string ApprovalKind { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string? ToolName { get; init; }
    public string? PermissionKind { get; init; }
    public string Title { get; init; } = string.Empty;
    public string? Detail { get; init; }
    public PermissionDetailDto? PermissionDetail { get; init; }
}

public sealed class UserInputRequestedEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string UserInputId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string Question { get; init; } = string.Empty;
    public IReadOnlyList<string>? Choices { get; init; }
    public bool? AllowFreeform { get; init; }
}

public sealed class McpOauthStaticClientConfigDto
{
    public string ClientId { get; init; } = string.Empty;
    public bool? PublicClient { get; init; }
}

public sealed class McpOauthRequiredEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string OauthRequestId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string ServerName { get; init; } = string.Empty;
    public string ServerUrl { get; init; } = string.Empty;
    public McpOauthStaticClientConfigDto? StaticClientConfig { get; init; }
}

public sealed class ExitPlanModeRequestedEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string ExitPlanId { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string Summary { get; init; } = string.Empty;
    public string PlanContent { get; init; } = string.Empty;
    public IReadOnlyList<string>? Actions { get; init; }
    public string? RecommendedAction { get; init; }
}

public sealed class CommandErrorEventDto : SidecarEventDto
{
    public string Message { get; init; } = string.Empty;
}

public sealed class CommandCompleteEventDto : SidecarEventDto;
