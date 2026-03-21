using Kopaya.AgentHost.Contracts;
using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

public sealed class PatternValidatorTests
{
    private readonly PatternValidator _validator = new();

    [Fact]
    public void SingleAgentPattern_WithExactlyOneAgent_IsValid()
    {
        IReadOnlyList<PatternValidationIssueDto> issues = _validator.Validate(
            CreatePattern(
                "single",
                [CreateAgent()]));

        Assert.Empty(issues);
    }

    [Fact]
    public void HandoffPattern_WithSingleAgent_IsReportedAsInvalid()
    {
        IReadOnlyList<PatternValidationIssueDto> issues = _validator.Validate(
            CreatePattern(
                "handoff",
                [CreateAgent()]));

        Assert.Contains(issues, issue =>
            issue.Field == "agents"
            && issue.Message == "Handoff orchestration requires at least two agents.");
    }

    [Fact]
    public void AgentWithoutModel_IsReportedAsInvalid()
    {
        IReadOnlyList<PatternValidationIssueDto> issues = _validator.Validate(
            CreatePattern(
                "sequential",
                [
                    CreateAgent(model: ""),
                    CreateAgent(id: "agent-2", name: "Reviewer"),
                ]));

        Assert.Contains(issues, issue =>
            issue.Field == "agents.model"
            && issue.Message == "Agent \"Primary\" requires a model identifier.");
    }

    [Fact]
    public void MagenticPattern_IsReportedAsUnavailable()
    {
        IReadOnlyList<PatternValidationIssueDto> issues = _validator.Validate(
            CreatePattern(
                "magentic",
                [
                    CreateAgent(id: "agent-1", name: "Planner", instructions: "Plan the task."),
                    CreateAgent(
                        id: "agent-2",
                        name: "Specialist",
                        model: "claude-opus-4.5",
                        instructions: "Complete the task."),
                ],
                availability: "unavailable",
                unavailabilityReason: "Unsupported in C#.",
                name: "Magentic"));

        Assert.Contains(issues, issue =>
            issue.Field == "availability"
            && issue.Message.Contains("Unsupported", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(issues, issue =>
            issue.Field == "mode"
            && issue.Message.Contains("Unsupported", StringComparison.OrdinalIgnoreCase));
    }

    private static PatternDefinitionDto CreatePattern(
        string mode,
        IReadOnlyList<PatternAgentDefinitionDto> agents,
        string availability = "available",
        string? unavailabilityReason = null,
        string name = "Pattern")
    {
        return new PatternDefinitionDto
        {
            Id = $"{mode}-pattern",
            Name = name,
            Mode = mode,
            Availability = availability,
            UnavailabilityReason = unavailabilityReason,
            Agents = agents,
        };
    }

    private static PatternAgentDefinitionDto CreateAgent(
        string id = "agent-1",
        string name = "Primary",
        string model = "gpt-5.4",
        string instructions = "Help with the user's request.")
    {
        return new PatternAgentDefinitionDto
        {
            Id = id,
            Name = name,
            Model = model,
            Instructions = instructions,
        };
    }
}
