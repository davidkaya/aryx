using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;
using System.Text.Json;

namespace Aryx.AgentHost.Tests;

public sealed class WorkflowRunnerTests
{
    [Fact]
    public async Task BuildWorkflow_AcceptsInlineSubworkflows()
    {
        WorkflowRunner runner = new();
        Workflow workflow = runner.BuildWorkflow(
            CreateSubworkflowParent(inlineWorkflow: CreateAgentWorkflow("child-inline", "agent-child")),
            CreatePattern("agent-child"),
            [CreateChatClientAgent("agent-child", "Child Agent")]);

        ProtocolDescriptor descriptor = await workflow.DescribeProtocolAsync();

        Assert.Contains(descriptor.Yields, candidate => candidate == typeof(List<ChatMessage>));
    }

    [Fact]
    public async Task BuildWorkflow_AcceptsReferencedSubworkflowsFromWorkflowLibrary()
    {
        WorkflowRunner runner = new();
        WorkflowDefinitionDto childWorkflow = CreateAgentWorkflow("child-ref", "agent-child");
        Workflow workflow = runner.BuildWorkflow(
            CreateSubworkflowParent(workflowId: childWorkflow.Id),
            CreatePattern("agent-child"),
            [CreateChatClientAgent("agent-child", "Child Agent")],
            [childWorkflow]);

        ProtocolDescriptor descriptor = await workflow.DescribeProtocolAsync();

        Assert.Contains(descriptor.Yields, candidate => candidate == typeof(List<ChatMessage>));
    }

    [Fact]
    public void BuildWorkflow_RejectsUnknownReferencedSubworkflows()
    {
        WorkflowRunner runner = new();

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => runner.BuildWorkflow(
            CreateSubworkflowParent(workflowId: "missing-child"),
            CreatePattern("agent-child"),
            [CreateChatClientAgent("agent-child", "Child Agent")],
            []));

        Assert.Contains("unknown workflow", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task BuildWorkflow_RunsCodeExecutorAndSurfacesOutput()
    {
        WorkflowRunner runner = new();
        Workflow workflow = runner.BuildWorkflow(
            CreateSingleNodeWorkflow(
                "code-executor",
                new WorkflowNodeConfigDto
                {
                    Kind = "code-executor",
                    Implementation = "return-text:done",
                }),
            CreateEmptyPattern(),
            []);

        List<ChatMessage> output = await RunWorkflowToOutputAsync(workflow);

        ChatMessage message = Assert.Single(output);
        Assert.Equal("done", message.Text);
        Assert.Equal("Workflow", message.AuthorName);
    }

    [Fact]
    public async Task BuildWorkflow_FunctionExecutorsUseStateScopes()
    {
        WorkflowRunner runner = new();
        Workflow workflow = runner.BuildWorkflow(
            CreateStatefulFunctionWorkflow(),
            CreateEmptyPattern(),
            []);

        List<ChatMessage> output = await RunWorkflowToOutputAsync(workflow);

        ChatMessage message = Assert.Single(output);
        Assert.Equal("{\"status\":\"complete\"}", message.Text);
    }

    [Fact]
    public async Task BuildWorkflow_RequestPortsRaiseRequestsAndForwardResponses()
    {
        WorkflowRunner runner = new();
        Workflow workflow = runner.BuildWorkflow(
            CreateSingleNodeWorkflow(
                "request-port",
                new WorkflowNodeConfigDto
                {
                    Kind = "request-port",
                    PortId = "approval",
                    RequestType = "Question",
                    ResponseType = "string",
                    Prompt = "Approve the workflow?",
                }),
            CreateEmptyPattern(),
            []);

        ChatMessage[] input =
        [
            new(ChatRole.User, "Please continue."),
        ];

        await using StreamingRun run = await InProcessExecution.RunStreamingAsync(workflow, input);

        await foreach (WorkflowEvent evt in run.WatchStreamAsync())
        {
            if (evt is RequestInfoEvent requestInfo)
            {
                Assert.Equal("approval", requestInfo.Request.PortInfo.PortId);
                WorkflowRequestPortPromptRequest payload = Assert.IsType<WorkflowRequestPortPromptRequest>(
                    requestInfo.Request.Data.As<object>());
                Assert.Equal("Approve the workflow?", payload.Prompt);
                Assert.Equal("request-port", payload.NodeId);
                await run.SendResponseAsync(requestInfo.Request.CreateResponse("approved"));
                continue;
            }

            if (evt is WorkflowOutputEvent outputEvent)
            {
                List<ChatMessage> output = Assert.IsType<List<ChatMessage>>(outputEvent.Data);
                ChatMessage message = Assert.Single(output);
                Assert.Equal("approved", message.Text);
                return;
            }
        }

        Assert.Fail("Workflow never produced an output after the request port response.");
    }

    [Fact]
    public void BuildWorkflow_RejectsUnknownFunctionRefsAtBuildTime()
    {
        WorkflowRunner runner = new();

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => runner.BuildWorkflow(
            CreateSingleNodeWorkflow(
                "function-executor",
                new WorkflowNodeConfigDto
                {
                    Kind = "function-executor",
                    FunctionRef = "missing-function",
                }),
            CreateEmptyPattern(),
            []));

        Assert.Contains("unsupported functionRef", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static PatternDefinitionDto CreatePattern(string agentId)
    {
        return new PatternDefinitionDto
        {
            Id = "pattern-1",
            Name = "Workflow Pattern",
            Mode = "single",
            Availability = "available",
            Agents =
            [
                new PatternAgentDefinitionDto
                {
                    Id = agentId,
                    Name = "Child Agent",
                    Instructions = "Help with the request.",
                    Model = "gpt-5.4",
                },
            ],
        };
    }

    private static WorkflowDefinitionDto CreateAgentWorkflow(string id, string agentId)
    {
        return new WorkflowDefinitionDto
        {
            Id = id,
            Name = "Child Workflow",
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
                        Id = agentId,
                        Kind = "agent",
                        Label = "Child Agent",
                        Config = new WorkflowNodeConfigDto
                        {
                            Kind = "agent",
                            Id = agentId,
                            Name = "Child Agent",
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
                        Target = agentId,
                        Kind = "direct",
                    },
                    new WorkflowEdgeDto
                    {
                        Id = "edge-agent-end",
                        Source = agentId,
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

    private static PatternDefinitionDto CreateEmptyPattern()
    {
        return new PatternDefinitionDto
        {
            Id = "pattern-empty",
            Name = "Workflow Pattern",
            Mode = "single",
            Availability = "available",
            Agents = [],
        };
    }

    private static WorkflowDefinitionDto CreateSubworkflowParent(
        string? workflowId = null,
        WorkflowDefinitionDto? inlineWorkflow = null)
    {
        return new WorkflowDefinitionDto
        {
            Id = "parent-workflow",
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

    private static WorkflowDefinitionDto CreateStatefulFunctionWorkflow()
    {
        return new WorkflowDefinitionDto
        {
            Id = "workflow-stateful-function",
            Name = "Stateful Function Workflow",
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
                        Id = "state-get",
                        Kind = "function-executor",
                        Label = "Get State",
                        Config = new WorkflowNodeConfigDto
                        {
                            Kind = "function-executor",
                            FunctionRef = "state:get",
                            Parameters = new Dictionary<string, JsonElement>
                            {
                                ["scope"] = JsonDocument.Parse("\"workflow\"").RootElement.Clone(),
                                ["key"] = JsonDocument.Parse("\"status\"").RootElement.Clone(),
                            },
                        },
                    },
                    new WorkflowNodeDto
                    {
                        Id = "state-set",
                        Kind = "function-executor",
                        Label = "Set State",
                        Config = new WorkflowNodeConfigDto
                        {
                            Kind = "function-executor",
                            FunctionRef = "state:set",
                            Parameters = new Dictionary<string, JsonElement>
                            {
                                ["scope"] = JsonDocument.Parse("\"workflow\"").RootElement.Clone(),
                                ["key"] = JsonDocument.Parse("\"status\"").RootElement.Clone(),
                                ["value"] = JsonDocument.Parse("{\"status\":\"complete\"}").RootElement.Clone(),
                            },
                        },
                    },
                    new WorkflowNodeDto
                    {
                        Id = "state-read-back",
                        Kind = "code-executor",
                        Label = "Read Back",
                        Config = new WorkflowNodeConfigDto
                        {
                            Kind = "code-executor",
                            Implementation = "state:get:workflow:status",
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
                        Id = "edge-start-get",
                        Source = "start",
                        Target = "state-get",
                        Kind = "direct",
                    },
                    new WorkflowEdgeDto
                    {
                        Id = "edge-get-set",
                        Source = "state-get",
                        Target = "state-set",
                        Kind = "direct",
                    },
                    new WorkflowEdgeDto
                    {
                        Id = "edge-set-read",
                        Source = "state-set",
                        Target = "state-read-back",
                        Kind = "direct",
                    },
                    new WorkflowEdgeDto
                    {
                        Id = "edge-read-end",
                        Source = "state-read-back",
                        Target = "end",
                        Kind = "direct",
                    },
                ],
            },
            Settings = new WorkflowSettingsDto
            {
                Checkpointing = new WorkflowCheckpointSettingsDto(),
                StateScopes =
                [
                    new WorkflowStateScopeDto
                    {
                        Name = "workflow",
                        InitialValues = new Dictionary<string, JsonElement>
                        {
                            ["status"] = JsonDocument.Parse("\"pending\"").RootElement.Clone(),
                        },
                    },
                ],
            },
        };
    }

    private static async Task<List<ChatMessage>> RunWorkflowToOutputAsync(Workflow workflow)
    {
        ChatMessage[] input =
        [
            new(ChatRole.User, "Run the workflow."),
        ];

        await using StreamingRun run = await InProcessExecution.RunStreamingAsync(workflow, input);

        await foreach (WorkflowEvent evt in run.WatchStreamAsync())
        {
            if (evt is WorkflowOutputEvent outputEvent)
            {
                return Assert.IsType<List<ChatMessage>>(outputEvent.Data);
            }
        }

        Assert.Fail("Workflow did not produce an output.");
        return [];
    }

    private static ChatClientAgent CreateChatClientAgent(string id, string name)
    {
        return new ChatClientAgent(
            new StubChatClient(),
            id,
            name,
            "Stub agent for workflow runner tests.",
            [],
            null!,
            null!);
    }

    private sealed class StubChatClient : IChatClient
    {
        public void Dispose()
        {
        }

        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public object? GetService(Type serviceType, object? serviceKey = null)
        {
            return null;
        }

        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }
    }
}
