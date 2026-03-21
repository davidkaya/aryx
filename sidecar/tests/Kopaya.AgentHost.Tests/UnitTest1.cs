using Kopaya.AgentHost.Contracts;
using Kopaya.AgentHost.Services;

namespace Kopaya.AgentHost.Tests;

public sealed class PatternValidatorTests
{
    private readonly PatternValidator _validator = new();

    [Fact]
    public void SingleAgentPattern_WithExactlyOneAgent_IsValid()
    {
        PatternDefinitionDto pattern = new()
        {
            Id = "single",
            Name = "Single",
            Mode = "single",
            Availability = "available",
            Agents =
            [
                new PatternAgentDefinitionDto
                {
                    Id = "agent-1",
                    Name = "Primary",
                    Model = "gpt-5.4",
                    Instructions = "Help with the user's request.",
                },
            ],
        };

        IReadOnlyList<PatternValidationIssueDto> issues = _validator.Validate(pattern);

        Assert.Empty(issues);
    }

    [Fact]
    public void MagenticPattern_IsReportedAsUnavailable()
    {
        PatternDefinitionDto pattern = new()
        {
            Id = "magentic",
            Name = "Magentic",
            Mode = "magentic",
            Availability = "unavailable",
            UnavailabilityReason = "Unsupported in C#.",
            Agents =
            [
                new PatternAgentDefinitionDto
                {
                    Id = "agent-1",
                    Name = "Planner",
                    Model = "gpt-5.4",
                    Instructions = "Plan the task.",
                },
                new PatternAgentDefinitionDto
                {
                    Id = "agent-2",
                    Name = "Specialist",
                    Model = "claude-opus-4.5",
                    Instructions = "Complete the task.",
                },
            ],
        };

        IReadOnlyList<PatternValidationIssueDto> issues = _validator.Validate(pattern);

        Assert.Contains(issues, issue => issue.Message.Contains("Unsupported", StringComparison.OrdinalIgnoreCase));
    }
}
