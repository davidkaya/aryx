using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class AgentInstructionComposerTests
{
    [Fact]
    public void Compose_LeavesNonHandoffInstructionsUnchanged()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow("sequential");
        WorkflowNodeDto agent = CreateAgent("agent-reviewer", "Reviewer", "Review the proposal.");

        string instructions = AgentInstructionComposer.Compose(workflow, agent, agentIndex: 0);

        Assert.Equal("Review the proposal.", instructions);
    }

    [Fact]
    public void Compose_StrengthensGroupChatCollaborationRoles()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow("group-chat");
        WorkflowNodeDto writer = CreateAgent("agent-group-writer", "Writer", "Draft an answer.");
        WorkflowNodeDto reviewer = CreateAgent("agent-group-reviewer", "Reviewer", "Review the draft.");

        string writerInstructions = AgentInstructionComposer.Compose(workflow, writer, agentIndex: 0);
        string reviewerInstructions = AgentInstructionComposer.Compose(workflow, reviewer, agentIndex: 1);

        Assert.Contains("collaborative multi-turn group chat", writerInstructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("refine your earlier draft", writerInstructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("specific critique or improvements", reviewerInstructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not restart the conversation", reviewerInstructions, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Compose_LeavesHandoffTriagePromptFocusedOnAgentInstructions()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow("handoff");
        WorkflowNodeDto triage = CreateAgent(
            "agent-handoff-triage",
            "Triage",
            "You triage requests and must hand them off to the most appropriate specialist.");

        string instructions = AgentInstructionComposer.Compose(workflow, triage, agentIndex: 0);

        Assert.Equal("You triage requests and must hand them off to the most appropriate specialist.", instructions);
        Assert.DoesNotContain("routing", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("actual handoff", instructions, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Compose_LeavesHandoffSpecialistPromptFocusedOnAgentInstructions()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow("handoff");
        WorkflowNodeDto specialist = CreateAgent(
            "agent-handoff-ux",
            "UX Specialist",
            "You focus on navigation, UX, and interaction details.");

        string instructions = AgentInstructionComposer.Compose(workflow, specialist, agentIndex: 1);

        Assert.Equal("You focus on navigation, UX, and interaction details.", instructions);
        Assert.DoesNotContain("triage agent", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("substantive answer", instructions, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Compose_AddsScratchpadGuidanceForProjectlessQaSessions()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow("single");
        WorkflowNodeDto agent = CreateAgent("agent-primary", "Primary Agent", "You are a helpful assistant.");

        string instructions = AgentInstructionComposer.Compose(
            workflow,
            agent,
            agentIndex: 0,
            workspaceKind: "scratchpad");

        Assert.Contains("scratchpad mode", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ad-hoc work inside the scratchpad workspace", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("use the available tools and files inside the scratchpad workspace", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Do not inspect, modify, create, or delete files", instructions, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Compose_AddsPlanModeGuidanceWhenRequested()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow("single");
        WorkflowNodeDto agent = CreateAgent("agent-primary", "Primary Agent", "You are a helpful assistant.");

        string instructions = AgentInstructionComposer.Compose(
            workflow,
            agent,
            agentIndex: 0,
            interactionMode: "plan");

        Assert.Contains("operating in plan mode", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("produce a concrete implementation plan", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("exit_plan_mode", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not continue into implementation", instructions, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Compose_InsertsProjectInstructionsBetweenBaseAndRuntimeGuidance()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow("single");
        WorkflowNodeDto agent = CreateAgent("agent-primary", "Primary Agent", "You are a helpful assistant.");

        string instructions = AgentInstructionComposer.Compose(
            workflow,
            agent,
            agentIndex: 0,
            workspaceKind: "scratchpad",
            projectInstructions: "Follow the repository guide.");

        Assert.Contains("You are a helpful assistant.", instructions, StringComparison.Ordinal);
        Assert.Contains("Follow the repository guide.", instructions, StringComparison.Ordinal);
        Assert.Contains("scratchpad mode", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.True(
            instructions.IndexOf("You are a helpful assistant.", StringComparison.Ordinal)
            < instructions.IndexOf("Follow the repository guide.", StringComparison.Ordinal));
        Assert.True(
            instructions.IndexOf("Follow the repository guide.", StringComparison.Ordinal)
            < instructions.IndexOf("scratchpad mode", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Compose_AppendsPromptInvocationAsATaskDirective()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow("single");
        WorkflowNodeDto agent = CreateAgent("agent-primary", "Primary Agent", "You are a helpful assistant.");

        string instructions = AgentInstructionComposer.Compose(
            workflow,
            agent,
            agentIndex: 0,
            promptInvocation: new RunTurnPromptInvocationDto
            {
                Id = "project_customization_prompt_doc_review",
                Name = "doc-review",
                SourcePath = @".github\prompts\docs\doc-review.prompt.md",
                Description = "Review docs for missing steps",
                Agent = "plan",
                Model = "Claude Sonnet 4.5",
                Tools = ["view", "glob"],
                ResolvedPrompt = "Review the docs for missing steps and propose updates."
            });

        Assert.Contains("repository prompt file", instructions, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(@"Source: .github\prompts\docs\doc-review.prompt.md", instructions, StringComparison.Ordinal);
        Assert.Contains("Name: doc-review", instructions, StringComparison.Ordinal);
        Assert.Contains("Description: Review docs for missing steps", instructions, StringComparison.Ordinal);
        Assert.Contains("Agent: plan", instructions, StringComparison.Ordinal);
        Assert.Contains("Model: Claude Sonnet 4.5", instructions, StringComparison.Ordinal);
        Assert.Contains("Tools: view, glob", instructions, StringComparison.Ordinal);
        Assert.Contains(
            "Prompt instructions:\nReview the docs for missing steps and propose updates.",
            instructions,
            StringComparison.Ordinal);
    }

    private static WorkflowDefinitionDto CreateWorkflow(string orchestrationMode)
    {
        return new WorkflowDefinitionDto
        {
            Id = $"{orchestrationMode}-workflow",
            Name = "Workflow",
            Settings = new WorkflowSettingsDto
            {
                OrchestrationMode = orchestrationMode,
            },
        };
    }

    private static WorkflowNodeDto CreateAgent(string id, string name, string instructions)
    {
        return new WorkflowNodeDto
        {
            Id = id,
            Kind = "agent",
            Label = name,
            Config = new WorkflowNodeConfigDto
            {
                Kind = "agent",
                Id = id,
                Name = name,
                Instructions = instructions,
                Model = "gpt-5.4",
            },
        };
    }
}
