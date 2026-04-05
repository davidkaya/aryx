using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class WorkflowValidatorTests
{
    private readonly WorkflowValidator _validator = new();

    [Fact]
    public void Validate_AcceptsInlineSubworkflowNodes()
    {
        WorkflowDefinitionDto workflow = CreateSubworkflowParent(inlineWorkflow: CreateWorkflow(id: "child"));

        IReadOnlyList<WorkflowValidationIssueDto> issues = _validator.Validate(workflow);

        Assert.DoesNotContain(issues, issue => issue.Level == "error");
    }

    [Fact]
    public void Validate_RejectsSubworkflowNodesWithoutSingleSource()
    {
        WorkflowDefinitionDto workflow = CreateSubworkflowParent();

        IReadOnlyList<WorkflowValidationIssueDto> issues = _validator.Validate(workflow);

        Assert.Contains(issues, issue => issue.Field == "graph.nodes.config");
    }

    [Fact]
    public void Validate_RejectsUnknownReferencedWorkflowIdsWhenLibraryProvided()
    {
        WorkflowDefinitionDto workflow = CreateSubworkflowParent(workflowId: "missing-child");

        IReadOnlyList<WorkflowValidationIssueDto> issues = _validator.Validate(workflow, []);

        Assert.Contains(issues, issue => issue.Field == "graph.nodes.config.workflowId");
    }

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

    [Fact]
    public void Validate_AcceptsPhase4ExecutableNodeKinds()
    {
        WorkflowDefinitionDto codeWorkflow = CreateSingleNodeWorkflow(
            "code-executor",
            new WorkflowNodeConfigDto
            {
                Kind = "code-executor",
                Implementation = "return-text:done",
            });
        WorkflowDefinitionDto functionWorkflow = CreateSingleNodeWorkflow(
            "function-executor",
            new WorkflowNodeConfigDto
            {
                Kind = "function-executor",
                FunctionRef = "identity",
            });
        WorkflowDefinitionDto requestPortWorkflow = CreateSingleNodeWorkflow(
            "request-port",
            new WorkflowNodeConfigDto
            {
                Kind = "request-port",
                PortId = "approval",
                RequestType = "Question",
                ResponseType = "string",
            });

        Assert.DoesNotContain(_validator.Validate(codeWorkflow), issue => issue.Level == "error");
        Assert.DoesNotContain(_validator.Validate(functionWorkflow), issue => issue.Level == "error");
        Assert.DoesNotContain(_validator.Validate(requestPortWorkflow), issue => issue.Level == "error");
    }

    [Fact]
    public void Validate_RejectsInvalidPhase4ExecutorConfigs()
    {
        WorkflowDefinitionDto codeWorkflow = CreateSingleNodeWorkflow(
            "code-executor",
            new WorkflowNodeConfigDto
            {
                Kind = "code-executor",
                Implementation = "   ",
            });
        WorkflowDefinitionDto functionWorkflow = CreateSingleNodeWorkflow(
            "function-executor",
            new WorkflowNodeConfigDto
            {
                Kind = "function-executor",
                FunctionRef = string.Empty,
            });
        WorkflowDefinitionDto requestPortWorkflow = CreateSingleNodeWorkflow(
            "request-port",
            new WorkflowNodeConfigDto
            {
                Kind = "request-port",
                PortId = " ",
                RequestType = "",
                ResponseType = null,
            });

        Assert.Contains(_validator.Validate(codeWorkflow), issue => issue.Field == "graph.nodes.config.implementation");
        Assert.Contains(_validator.Validate(functionWorkflow), issue => issue.Field == "graph.nodes.config.functionRef");

        IReadOnlyList<WorkflowValidationIssueDto> requestPortIssues = _validator.Validate(requestPortWorkflow);
        Assert.Contains(requestPortIssues, issue => issue.Field == "graph.nodes.config.portId");
        Assert.Contains(requestPortIssues, issue => issue.Field == "graph.nodes.config.requestType");
        Assert.Contains(requestPortIssues, issue => issue.Field == "graph.nodes.config.responseType");
    }

    private static WorkflowDefinitionDto CreateWorkflow(string id = "workflow-1")
    {
        return new WorkflowDefinitionDto
        {
            Id = id,
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

    private static WorkflowDefinitionDto CreateSubworkflowParent(
        string? workflowId = null,
        WorkflowDefinitionDto? inlineWorkflow = null)
    {
        return new WorkflowDefinitionDto
        {
            Id = "workflow-parent",
            Name = "Parent Workflow",
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
                        Id = "sub-workflow",
                        Kind = "sub-workflow",
                        Label = "Nested Workflow",
                        Config = new WorkflowNodeConfigDto
                        {
                            Kind = "sub-workflow",
                            WorkflowId = workflowId,
                            InlineWorkflow = inlineWorkflow,
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
                        Id = "edge-start-sub",
                        Source = "start",
                        Target = "sub-workflow",
                        Kind = "direct",
                    },
                    new WorkflowEdgeDto
                    {
                        Id = "edge-sub-end",
                        Source = "sub-workflow",
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

    private static WorkflowDefinitionDto CreateSingleNodeWorkflow(string nodeKind, WorkflowNodeConfigDto config)
    {
        return new WorkflowDefinitionDto
        {
            Id = $"workflow-{nodeKind}",
            Name = $"{nodeKind} Workflow",
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
                        Id = nodeKind,
                        Kind = nodeKind,
                        Label = nodeKind,
                        Config = config,
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
                        Id = "edge-start-node",
                        Source = "start",
                        Target = nodeKind,
                        Kind = "direct",
                    },
                    new WorkflowEdgeDto
                    {
                        Id = "edge-node-end",
                        Source = nodeKind,
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
