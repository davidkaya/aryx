using Eryx.AgentHost.Contracts;

namespace Eryx.AgentHost.Services;

public sealed class PatternValidator
{
    public IReadOnlyList<PatternValidationIssueDto> Validate(PatternDefinitionDto pattern)
    {
        List<PatternValidationIssueDto> issues = [];

        if (string.IsNullOrWhiteSpace(pattern.Name))
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "name",
                Message = "Pattern name is required.",
            });
        }

        if (string.Equals(pattern.Availability, "unavailable", StringComparison.OrdinalIgnoreCase))
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "availability",
                Message = pattern.UnavailabilityReason ?? "This orchestration mode is currently unavailable.",
            });
        }

        if (pattern.Agents.Count == 0)
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "agents",
                Message = "At least one agent is required.",
            });
        }

        if (string.Equals(pattern.Mode, "single", StringComparison.OrdinalIgnoreCase) && pattern.Agents.Count != 1)
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "agents",
                Message = "Single-agent chat requires exactly one agent.",
            });
        }

        if (string.Equals(pattern.Mode, "handoff", StringComparison.OrdinalIgnoreCase) && pattern.Agents.Count < 2)
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "agents",
                Message = "Handoff orchestration requires at least two agents.",
            });
        }

        if (string.Equals(pattern.Mode, "group-chat", StringComparison.OrdinalIgnoreCase) && pattern.Agents.Count < 2)
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "agents",
                Message = "Group chat requires at least two agents.",
            });
        }

        if (string.Equals(pattern.Mode, "magentic", StringComparison.OrdinalIgnoreCase))
        {
            issues.Add(new PatternValidationIssueDto
            {
                Field = "mode",
                Message = pattern.UnavailabilityReason
                    ?? "Magentic orchestration is currently documented as unsupported in the .NET Agent Framework.",
            });
        }

        foreach (PatternAgentDefinitionDto agent in pattern.Agents)
        {
            if (string.IsNullOrWhiteSpace(agent.Name))
            {
                issues.Add(new PatternValidationIssueDto
                {
                    Field = "agents.name",
                    Message = "Every agent needs a name.",
                });
            }

            if (string.IsNullOrWhiteSpace(agent.Model))
            {
                issues.Add(new PatternValidationIssueDto
                {
                    Field = "agents.model",
                    Message = $"Agent \"{agent.Name}\" requires a model identifier.",
                });
            }
        }

        return issues;
    }
}
