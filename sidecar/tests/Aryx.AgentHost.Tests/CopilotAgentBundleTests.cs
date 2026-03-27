using System.Reflection;
using System.Text.Json;
using GitHub.Copilot.SDK;
using Aryx.AgentHost.Services;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotAgentBundleTests
{
    [Fact]
    public void ApplySessionTooling_MapsMcpServersAndToolsOntoTheSessionConfig()
    {
        SessionConfig sessionConfig = new()
        {
            AvailableTools = ["glob"],
        };
        Dictionary<string, object> mcpServers = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Git MCP"] = new McpLocalServerConfig
            {
                Type = "local",
                Command = "node",
                Args = ["server.js"],
                Tools = ["git.status"],
            },
        };
        AIFunction tool = CreateTool();

        CopilotAgentBundle.ApplySessionTooling(sessionConfig, mcpServers, [tool]);

        Assert.Same(mcpServers, sessionConfig.McpServers);
        Assert.NotNull(sessionConfig.Tools);
        AIFunction configuredTool = Assert.Single(sessionConfig.Tools);
        Assert.Same(tool, configuredTool);
        Assert.Equal(["glob"], sessionConfig.AvailableTools);
    }

    [Fact]
    public void ApplySessionTooling_LeavesSessionConfigUnsetWhenNoToolingIsProvided()
    {
        SessionConfig sessionConfig = new()
        {
            AvailableTools = ["glob", "view"],
        };

        CopilotAgentBundle.ApplySessionTooling(sessionConfig, null, []);

        Assert.Null(sessionConfig.McpServers);
        Assert.Null(sessionConfig.Tools);
        Assert.Equal(["glob", "view"], sessionConfig.AvailableTools);
    }

    [Fact]
    public async Task CreateConfiguredSessionConfig_MergesInstructionsAndConvertsHandoffDeclarations()
    {
        SessionConfig baseConfig = new()
        {
            Model = "gpt-5.4",
            SystemMessage = new SystemMessageConfig
            {
                Content = "Base instructions",
            },
            Tools = [CreateTool()],
        };
        ChatClientAgentRunOptions options = new(new ChatOptions
        {
            Instructions = "Workflow handoff instructions",
            Tools = [CreateHandoffDeclaration()],
        });

        SessionConfig effective = AryxCopilotAgent.CreateConfiguredSessionConfig(baseConfig, options);

        Assert.Equal("gpt-5.4", effective.Model);
        Assert.Equal("Base instructions\n\nWorkflow handoff instructions", effective.SystemMessage?.Content);
        Assert.Equal("Base instructions", baseConfig.SystemMessage?.Content);

        AIFunction[] tools = Assert.IsAssignableFrom<IEnumerable<AIFunction>>(effective.Tools).ToArray();
        Assert.Equal(2, tools.Length);
        AIFunction handoffTool = Assert.Single(tools, tool => tool.Name == "handoff_to_1");
        Assert.True(handoffTool.AdditionalProperties.TryGetValue("skip_permission", out object? skipPermission));
        Assert.Equal(true, skipPermission);

        object? result = await handoffTool.InvokeAsync(new AIFunctionArguments
        {
            ["reasonForHandoff"] = "UI specialist",
        });

        Assert.Equal("Transferred.", result?.ToString());
    }

    [Fact]
    public void CreateConfiguredSessionConfig_RejectsUnsupportedRuntimeDeclarations()
    {
        ChatClientAgentRunOptions options = new(new ChatOptions
        {
            Tools = [AIFunctionFactory.CreateDeclaration("route_elsewhere", "Unsupported declaration", CreateTool().JsonSchema)],
        });

        Assert.Throws<NotSupportedException>(() => AryxCopilotAgent.CreateConfiguredSessionConfig(new SessionConfig(), options));
    }

    [Fact]
    public void ConvertToolRequestsToFunctionCalls_MapsCallIdsNamesAndArguments()
    {
        AssistantMessageDataToolRequestsItem[] toolRequests =
        {
            new()
            {
                ToolCallId = "call-123",
                Name = "handoff_to_1",
                Arguments = JsonSerializer.SerializeToElement(new Dictionary<string, object?>
                {
                    ["reasonForHandoff"] = "frontend specialist",
                }),
            },
        };

        FunctionCallContent functionCall = Assert.Single(AryxCopilotAgent.ConvertToolRequestsToFunctionCalls(toolRequests));

        Assert.Equal("call-123", functionCall.CallId);
        Assert.Equal("handoff_to_1", functionCall.Name);
        Assert.NotNull(functionCall.Arguments);
        Assert.Equal("frontend specialist", functionCall.Arguments["reasonForHandoff"]?.ToString());
    }

    private static AIFunction CreateTool()
    {
        ToolTarget target = new();
        MethodInfo method = typeof(ToolTarget).GetMethod(nameof(ToolTarget.Echo))
            ?? throw new InvalidOperationException("Expected test method to exist.");

        return AIFunctionFactory.Create(
            method,
            target,
            new AIFunctionFactoryOptions
            {
                Name = "echo",
                Description = "Echo test tool",
            });
    }

    private static AIFunctionDeclaration CreateHandoffDeclaration()
    {
        return AIFunctionFactory.CreateDeclaration(
            "handoff_to_1",
            "Transfer ownership to a specialist",
            CreateTool().JsonSchema);
    }

    private sealed class ToolTarget
    {
        public string Echo() => "ok";
    }
}
