using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

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
