using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class WorkflowValidatorTests
{
    private readonly WorkflowValidator _validator = new();

    [Fact]
    public void Validate_RejectsInvalidConditionOperator()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow();
        workflow = new WorkflowDefinitionDto
        {
            Id = workflow.Id,
            Name = workflow.Name,
            Settings = workflow.Settings,
            Graph = new WorkflowGraphDto
            {
                Nodes = workflow.Graph.Nodes,
                Edges =
                [
                    new WorkflowEdgeDto
                    {
                        Id = "edge-start-agent",
                        Source = "start",
                        Target = "agent",
                        Kind = "direct",
                        Condition = new EdgeConditionDto
                        {
                            Type = "property",
                            Rules =
                            [
                                new WorkflowConditionRuleDto
                                {
                                    PropertyPath = "Role",
                                    Operator = "bad-op",
                                    Value = "user",
                                },
                            ],
                        },
                    },
                    workflow.Graph.Edges[1],
                ],
            },
        };

        IReadOnlyList<WorkflowValidationIssueDto> issues = _validator.Validate(workflow);

        Assert.Contains(issues, issue => issue.Field == "graph.edges.condition.rules.operator");
    }

    [Fact]
    public void Validate_RejectsLoopWithoutMetadata()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow();
        workflow = new WorkflowDefinitionDto
        {
            Id = workflow.Id,
            Name = workflow.Name,
            Settings = workflow.Settings,
            Graph = new WorkflowGraphDto
            {
                Nodes = workflow.Graph.Nodes,
                Edges =
                [
                    .. workflow.Graph.Edges,
                    new WorkflowEdgeDto
                    {
                        Id = "edge-loop",
                        Source = "agent",
                        Target = "agent",
                        Kind = "direct",
                    },
                ],
            },
        };

        IReadOnlyList<WorkflowValidationIssueDto> issues = _validator.Validate(workflow);

        Assert.Contains(issues, issue => issue.Field == "graph.edges.isLoop");
        Assert.Contains(issues, issue => issue.Field == "graph.edges.condition");
        Assert.Contains(issues, issue => issue.Field == "graph.edges.maxIterations");
    }

    [Fact]
    public void Validate_AcceptsLoopWithExitPathConditionAndCap()
    {
        WorkflowDefinitionDto workflow = CreateWorkflow();
        workflow = new WorkflowDefinitionDto
        {
            Id = workflow.Id,
            Name = workflow.Name,
            Settings = workflow.Settings,
            Graph = new WorkflowGraphDto
            {
                Nodes = workflow.Graph.Nodes,
                Edges =
                [
                    .. workflow.Graph.Edges,
                    new WorkflowEdgeDto
                    {
                        Id = "edge-loop",
                        Source = "agent",
                        Target = "agent",
                        Kind = "direct",
                        IsLoop = true,
                        MaxIterations = 3,
                        Condition = new EdgeConditionDto
                        {
                            Type = "expression",
                            Expression = "Iteration < 3",
                        },
                    },
                ],
            },
        };

        IReadOnlyList<WorkflowValidationIssueDto> issues = _validator.Validate(workflow);

        Assert.DoesNotContain(issues, issue => issue.Level == "error");
    }

    private static WorkflowDefinitionDto CreateWorkflow()
    {
        return new WorkflowDefinitionDto
        {
            Id = "workflow-1",
            Name = "Loop Workflow",
            Graph = new WorkflowGraphDto
            {
                Nodes =
                [
                    new WorkflowNodeDto
                    {
                        Id = "start",
                        Kind = "start",
                        Label = "Start",
                        Config = new WorkflowNodeConfigDto { Kind = "start" },
                    },
                    new WorkflowNodeDto
                    {
                        Id = "agent",
                        Kind = "agent",
                        Label = "Agent",
                        Config = new WorkflowNodeConfigDto
                        {
                            Kind = "agent",
                            Id = "agent",
                            Name = "Agent",
                            Model = "gpt-5.4",
                        },
                    },
                    new WorkflowNodeDto
                    {
                        Id = "end",
                        Kind = "end",
                        Label = "End",
                        Config = new WorkflowNodeConfigDto { Kind = "end" },
                    },
                ],
                Edges =
                [
                    new WorkflowEdgeDto
                    {
                        Id = "edge-start-agent",
                        Source = "start",
                        Target = "agent",
                        Kind = "direct",
                    },
                    new WorkflowEdgeDto
                    {
                        Id = "edge-agent-end",
                        Source = "agent",
                        Target = "end",
                        Kind = "direct",
                    },
                ],
            },
            Settings = new WorkflowSettingsDto
            {
                Checkpointing = new WorkflowCheckpointSettingsDto(),
            },
        };
    }
}
