using System.Text.Json.Serialization;

namespace Kopaya.AgentHost.Contracts;

public sealed class PatternAgentDefinitionDto
{
    public string Id { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Instructions { get; init; } = string.Empty;
    public string Model { get; init; } = string.Empty;
    public string? ReasoningEffort { get; init; }
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
    public IReadOnlyList<PatternAgentDefinitionDto> Agents { get; init; } = [];
    public string CreatedAt { get; init; } = string.Empty;
    public string UpdatedAt { get; init; } = string.Empty;
}

public sealed class ChatMessageDto
{
    public string Id { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public string AuthorName { get; init; } = string.Empty;
    public string Content { get; init; } = string.Empty;
    public string CreatedAt { get; init; } = string.Empty;
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

public sealed class SidecarCapabilitiesDto
{
    public string Runtime { get; init; } = "dotnet-maf";
    public Dictionary<string, SidecarModeCapabilityDto> Modes { get; init; } = new(StringComparer.OrdinalIgnoreCase);
    public IReadOnlyList<SidecarModelCapabilityDto> Models { get; init; } = [];
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
    public PatternDefinitionDto Pattern { get; init; } = new();
    public IReadOnlyList<ChatMessageDto> Messages { get; init; } = [];
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
}

public sealed class TurnCompleteEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public IReadOnlyList<ChatMessageDto> Messages { get; init; } = [];
}

public sealed class AgentActivityEventDto : SidecarEventDto
{
    public string SessionId { get; init; } = string.Empty;
    public string ActivityType { get; init; } = string.Empty;
    public string? AgentId { get; init; }
    public string? AgentName { get; init; }
    public string? ToolName { get; init; }
}

public sealed class CommandErrorEventDto : SidecarEventDto
{
    public string Message { get; init; } = string.Empty;
}

public sealed class CommandCompleteEventDto : SidecarEventDto;
