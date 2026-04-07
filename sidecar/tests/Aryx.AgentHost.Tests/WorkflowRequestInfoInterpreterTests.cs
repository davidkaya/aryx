using System.Collections;
using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Tests;

public sealed class WorkflowRequestInfoInterpreterTests
{
    [Fact]
    public void TryCreateActivityFromRequest_ReturnsToolCallingActivityForFunctionCalls()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            new FunctionCallContent("call-1", "view", new Dictionary<string, object?>
            {
                ["path"] = @"C:\workspace\file.txt",
                ["viewRange"] = new object[] { 10, 25 },
            }));

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
        Assert.NotNull(activity.ToolArguments);
        Assert.Equal(@"C:\workspace\file.txt", activity.ToolArguments["path"]);
        Assert.Equal([10, 25], Assert.IsAssignableFrom<IReadOnlyList<object?>>(activity.ToolArguments["viewRange"]));
        Assert.Equal("view", toolNamesByCallId["call-1"]);
    }

    [Fact]
    public void TryCreateActivityFromRequest_MapsMcpToolCalls()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            CreateMcpToolCall(
                "call-1",
                "git.status",
                "Git MCP",
                new Dictionary<string, object?>
                {
                    ["path"] = @"C:\workspace",
                    ["includeIgnored"] = true,
                }));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.Equal("tool-calling", activity.ActivityType);
        Assert.Equal("git.status", activity.ToolName);
        Assert.NotNull(activity.ToolArguments);
        Assert.Equal(@"C:\workspace", activity.ToolArguments["path"]);
        Assert.Equal(true, activity.ToolArguments["includeIgnored"]);
        Assert.Equal("git.status", toolNamesByCallId["call-1"]);
    }

    [Fact]
    public void TryCreateActivityFromRequest_MapsCodeInterpreterCallsToSyntheticToolName()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            CreateCodeInterpreterToolCall("call-1", "print('hello')"));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.Equal("tool-calling", activity.ActivityType);
        Assert.Equal("code interpreter", activity.ToolName);
        Assert.NotNull(activity.ToolArguments);
        Assert.Equal(
            ["print('hello')"],
            Assert.IsAssignableFrom<IReadOnlyList<object?>>(activity.ToolArguments["inputs"]));
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
        Assert.Null(activity.ToolArguments);
        Assert.Empty(toolNamesByCallId);
    }

    [Fact]
    public void TryCreateActivityFromRequest_LeavesToolArgumentsNullWhenFunctionCallHasNoUsableArguments()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            new FunctionCallContent("call-1", "view", new Dictionary<string, object?>
            {
                ["empty"] = "   ",
                ["missing"] = null,
            }));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.Null(activity.ToolArguments);
    }

    [Fact]
    public void TryCreateActivityFromRequest_TruncatesOversizedToolArgumentValues()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal);
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            new FunctionCallContent(
                "call-1",
                "powershell",
                new Dictionary<string, object?>
                {
                    ["command"] = new string('x', 4001),
                }));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.NotNull(activity);
        Assert.NotNull(activity.ToolArguments);
        Assert.Equal("[truncated]", activity.ToolArguments["command"]);
    }

    [Fact]
    public void TryCreateActivityFromRequest_SkipsDuplicateTrackedToolCallIds()
    {
        ConcurrentDictionary<string, string> toolNamesByCallId = new(StringComparer.Ordinal)
        {
            ["call-1"] = "view",
        };
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            new FunctionCallContent("call-1", "view", new Dictionary<string, object?>()));

        AgentActivityEventDto? activity = WorkflowRequestInfoInterpreter.TryCreateActivityFromRequest(
            CreateSingleAgentCommand(),
            requestInfo,
            new AgentIdentity("agent-1", "Primary"),
            toolNamesByCallId);

        Assert.Null(activity);
        Assert.Equal("view", toolNamesByCallId["call-1"]);
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

    [Fact]
    public void RequiresUserInputTurnBoundary_ReturnsTrueForUnhandledHandoffRequests()
    {
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(new
        {
            Prompt = "Please provide more detail.",
        });

        bool requiresBoundary = WorkflowRequestInfoInterpreter.RequiresUserInputTurnBoundary(
            CreateHandoffCommand(),
            requestInfo);

        Assert.True(requiresBoundary);
    }

    [Fact]
    public void RequiresUserInputTurnBoundary_ReturnsFalseForExplicitHandoffs()
    {
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            CreateHandoffTarget("agent-handoff-ux", "UX Specialist"));

        bool requiresBoundary = WorkflowRequestInfoInterpreter.RequiresUserInputTurnBoundary(
            CreateHandoffCommand(),
            requestInfo);

        Assert.False(requiresBoundary);
    }

    [Fact]
    public void RequiresUserInputTurnBoundary_ReturnsFalseForToolRequests()
    {
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(
            new FunctionCallContent("call-1", "view", new Dictionary<string, object?>()));

        bool requiresBoundary = WorkflowRequestInfoInterpreter.RequiresUserInputTurnBoundary(
            CreateHandoffCommand(),
            requestInfo);

        Assert.False(requiresBoundary);
    }

    [Fact]
    public void RequiresUserInputTurnBoundary_ReturnsFalseOutsideHandoffMode()
    {
        RequestInfoEvent requestInfo = CreateRequestInfoEvent(new
        {
            Prompt = "Please provide more detail.",
        });

        bool requiresBoundary = WorkflowRequestInfoInterpreter.RequiresUserInputTurnBoundary(
            CreateSingleAgentCommand(),
            requestInfo);

        Assert.False(requiresBoundary);
    }

    private static RunTurnCommandDto CreateSingleAgentCommand()
        => CreateCommand("single", [CreateAgent("agent-1", "Primary")]);

    private static RunTurnCommandDto CreateHandoffCommand()
        => CreateCommand("handoff",
        [
            CreateAgent("agent-handoff-triage", "Triage"),
            CreateAgent("agent-handoff-ux", "UX Specialist"),
        ]);

    private static RunTurnCommandDto CreateCommand(string orchestrationMode, IReadOnlyList<WorkflowNodeDto> agents)
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Workflow = new WorkflowDefinitionDto
            {
                Id = $"{orchestrationMode}-workflow",
                Name = "Workflow",
                Graph = new WorkflowGraphDto
                {
                    Nodes = [.. agents],
                },
                Settings = new WorkflowSettingsDto
                {
                    OrchestrationMode = orchestrationMode,
                },
            },
        };
    }

    private static WorkflowNodeDto CreateAgent(string id, string name)
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
                Model = "gpt-5.4",
                Instructions = "Help with the request.",
            },
        };
    }

    private static RequestInfoEvent CreateRequestInfoEvent(object payload)
    {
        RequestPort port = RequestPort.Create<object, object>("test-port");
        ExternalRequest request = ExternalRequest.Create(port, payload, "request-1");
        return new RequestInfoEvent(request);
    }

    private static object CreateCodeInterpreterToolCall(string callId, params string[] inputs)
    {
        Type type = Type.GetType(
            "Microsoft.Extensions.AI.CodeInterpreterToolCallContent, Microsoft.Extensions.AI.Abstractions",
            throwOnError: true)!;
        object instance = Activator.CreateInstance(type)!;
        type.GetProperty("CallId")!.SetValue(instance, callId);
        if (inputs.Length > 0)
        {
            Type aiContentType = Type.GetType(
                "Microsoft.Extensions.AI.AIContent, Microsoft.Extensions.AI.Abstractions",
                throwOnError: true)!;
            Type textContentType = Type.GetType(
                "Microsoft.Extensions.AI.TextContent, Microsoft.Extensions.AI.Abstractions",
                throwOnError: true)!;
            IList values = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(aiContentType))!;
            foreach (string input in inputs)
            {
                object textContent = Activator.CreateInstance(textContentType, input)!;
                values.Add(textContent);
            }

            type.GetProperty("Inputs")!.SetValue(instance, values);
        }

        return instance;
    }

    private static object CreateMcpToolCall(
        string callId,
        string toolName,
        string serverName,
        IReadOnlyDictionary<string, object?>? arguments = null)
    {
        Type type = Type.GetType(
            "Microsoft.Extensions.AI.McpServerToolCallContent, Microsoft.Extensions.AI.Abstractions",
            throwOnError: true)!;
        object instance = Activator.CreateInstance(type, callId, toolName, serverName)!;
        if (arguments is not null)
        {
            type.GetProperty("Arguments")!.SetValue(instance, arguments);
        }

        return instance;
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
