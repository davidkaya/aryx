using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using Eryx.AgentHost.Contracts;
using Eryx.AgentHost.Services;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Tests;

public sealed class WorkflowRequestInfoInterpreterTests
{
    [Fact]
    public void TryCreateActivityFromRequest_ReturnsToolCallingActivityForFunctionCalls()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            new FunctionCallContent("call-1", "view", new Dictionary<string, object?>()));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.Equal("tool-calling", activity.ActivityType);
        Assert.Equal("agent-1", activity.AgentId);
        Assert.Equal("Primary", activity.AgentName);
        Assert.Equal("view", activity.ToolName);
        Assert.Equal("view", toolNamesByCallId["call-1"]);
    }

    [Fact]
    public void TryCreateActivityFromRequest_MapsMcpToolCalls()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            CreateMcpToolCall("call-1", "git.status", "Git MCP"));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.Equal("tool-calling", activity.ActivityType);
        Assert.Equal("git.status", activity.ToolName);
        Assert.Equal("git.status", toolNamesByCallId["call-1"]);
    }

    [Fact]
    public void TryCreateActivityFromRequest_MapsCodeInterpreterCallsToSyntheticToolName()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(CreateCodeInterpreterToolCall("call-1"));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.Equal("tool-calling", activity.ActivityType);
        Assert.Equal("code interpreter", activity.ToolName);
        Assert.Equal("code interpreter", toolNamesByCallId["call-1"]);
    }

    [Fact]
    public void TryCreateActivityFromRequest_MapsImageGenerationCallsWithoutTrackingCallId()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(CreateImageGenerationToolCall());

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.Equal("tool-calling", activity.ActivityType);
        Assert.Equal("image generation", activity.ToolName);
        Assert.Empty(toolNamesByCallId);
    }

    [Fact]
    public void TryCreateActivityFromRequest_ReturnsHandoffActivityForKnownTargets()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            CreateHandoffTarget("agent-handoff-ux", "UX Specialist"));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateHandoffCommand(),
            requestInfo,
            new AgentIdentity("agent-handoff-triage", "Triage"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.Equal("handoff", activity.ActivityType);
        Assert.Equal("agent-handoff-ux", activity.AgentId);
        Assert.Equal("UX Specialist", activity.AgentName);
        Assert.Equal("agent-handoff-triage", activity.SourceAgentId);
        Assert.Equal("Triage", activity.SourceAgentName);
        Assert.Null(activity.ToolName);
        Assert.Empty(toolNamesByCallId);
    }

    private static RunTurnCommandDto CreateSingleAgentCommand()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-single",
                Name = "Single Agent",
                Mode = "single",
                Availability = "available",
                Agents =
                [
                    CreateAgent("agent-1", "Primary"),
                ],
            },
        };
    }

    private static RunTurnCommandDto CreateHandoffCommand()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-handoff",
                Name = "Handoff Flow",
                Mode = "handoff",
                Availability = "available",
                Agents =
                [
                    CreateAgent("agent-handoff-triage", "Triage"),
                    CreateAgent("agent-handoff-ux", "UX Specialist"),
                ],
            },
        };
    }

    private static PatternAgentDefinitionDto CreateAgent(string id, string name)
    {
        return new PatternAgentDefinitionDto
        {
            Id = id,
            Name = name,
            Model = "gpt-5.4",
            Instructions = "Help with the request.",
        };
    }

    private static RequestInfoEvent CreateRequestInfoEvent(object payload)
    {
        RequestPort port = RequestPort.Create<object, object>("test-port");
        ExternalRequest request = ExternalRequest.Create(port, payload, "request-1");
        return new RequestInfoEvent(request);
    }

    private static object CreateCodeInterpreterToolCall(string callId)
    {
        Type type = Type.GetType(
            "Microsoft.Extensions.AI.CodeInterpreterToolCallContent, Microsoft.Extensions.AI.Abstractions",
            throwOnError: true)!;
        object instance = Activator.CreateInstance(type)!;
        type.GetProperty("CallId")!.SetValue(instance, callId);
        return instance;
    }

    private static object CreateMcpToolCall(string callId, string toolName, string serverName)
    {
        Type type = Type.GetType(
            "Microsoft.Extensions.AI.McpServerToolCallContent, Microsoft.Extensions.AI.Abstractions",
            throwOnError: true)!;
        return Activator.CreateInstance(type, callId, toolName, serverName)!;
    }

    private static object CreateImageGenerationToolCall()
    {
        Type type = Type.GetType(
            "Microsoft.Extensions.AI.ImageGenerationToolCallContent, Microsoft.Extensions.AI.Abstractions",
            throwOnError: true)!;
        return Activator.CreateInstance(type)!;
    }

    private static object CreateHandoffTarget(string id, string name)
    {
        Type type = Type.GetType(
            "Microsoft.Agents.AI.Workflows.Specialized.HandoffTarget, Microsoft.Agents.AI.Workflows",
            throwOnError: true)!;
        return Activator.CreateInstance(type, CreateChatClientAgent(id, name), "Handle the UX work.")!;
    }

    private static ChatClientAgent CreateChatClientAgent(string id, string name)
    {
        return new ChatClientAgent(
            new StubChatClient(),
            id,
            name,
            "Stub agent for handoff tests.",
            [],
            null!,
            null!);
    }

    private sealed class StubChatClient : IChatClient
    {
        public Task<ChatResponse> GetResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options,
            CancellationToken cancellationToken)
        {
            throw new NotSupportedException();
        }

        public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(
            IEnumerable<ChatMessage> messages,
            ChatOptions? options,
            [EnumeratorCancellation]
            CancellationToken cancellationToken)
        {
            yield break;
        }

        public object? GetService(Type serviceType, object? serviceKey)
        {
            return null;
        }

        public void Dispose()
        {
        }
    }
}
