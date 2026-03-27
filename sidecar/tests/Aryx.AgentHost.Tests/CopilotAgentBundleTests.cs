using System.Reflection;
using Microsoft.Agents.AI;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;
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
    public void ApplyInitialHandoffEntryConstraints_DisablesCopilotToolsAndClearsSessionTooling()
    {
        SessionConfig sessionConfig = new()
        {
            AvailableTools = ["glob", "view"],
            ExcludedTools = ["edit"],
            McpServers = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            {
                ["Git MCP"] = new McpLocalServerConfig
                {
                    Type = "local",
                    Command = "node",
                },
            },
            Tools = [CreateTool()],
        };

        CopilotAgentBundle.ApplyInitialHandoffEntryConstraints(sessionConfig);

        Assert.Empty(sessionConfig.AvailableTools);
        Assert.Null(sessionConfig.ExcludedTools);
        Assert.Null(sessionConfig.McpServers);
        Assert.Null(sessionConfig.Tools);
    }

    [Fact]
    public void RequireInitialHandoffToolMode_RequiresAToolWhenHandoffToolsArePresent()
    {
        ChatClientAgentRunOptions options = new(new ChatOptions
        {
            Tools = [CreateHandoffTool(), CreateTool()],
        });

        ChatClientAgentRunOptions constrained = Assert.IsType<ChatClientAgentRunOptions>(
            CopilotAgentBundle.RequireInitialHandoffToolMode(options));

        Assert.NotSame(options, constrained);
        Assert.Null(options.ChatOptions?.ToolMode);
        Assert.Equal(ChatToolMode.RequireAny, constrained.ChatOptions?.ToolMode);
    }

    [Fact]
    public void RequireInitialHandoffToolMode_LeavesNonHandoffOptionsUnchanged()
    {
        ChatClientAgentRunOptions options = new(new ChatOptions
        {
            Tools = [CreateTool()],
        });

        Assert.Same(options, CopilotAgentBundle.RequireInitialHandoffToolMode(options));
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

    private static AIFunction CreateHandoffTool()
    {
        return AIFunctionFactory.Create(
            (string reasonForHandoff) => $"Handed off because {reasonForHandoff}.",
            new AIFunctionFactoryOptions
            {
                Name = "handoff_to_1",
                Description = "Transfer ownership to a specialist",
            });
    }

    private sealed class ToolTarget
    {
        public string Echo() => "ok";
    }
}
