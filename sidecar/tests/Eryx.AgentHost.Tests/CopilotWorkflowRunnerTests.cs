using Eryx.AgentHost.Contracts;
using Eryx.AgentHost.Services;
using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Tests;

public sealed class CopilotWorkflowRunnerTests
{
    [Fact]
    public void SelectNewOutputMessages_SkipsFullTranscriptPrefix()
    {
        List<ChatMessage> inputMessages =
        [
            new(ChatRole.User, "Hello"),
        ];
        List<ChatMessage> outputMessages =
        [
            new(ChatRole.User, "Hello"),
            new(ChatRole.Assistant, "Hi there."),
        ];

        IReadOnlyList<ChatMessage> newMessages = CopilotWorkflowRunner.SelectNewOutputMessages(
            outputMessages,
            inputMessages);

        ChatMessage message = Assert.Single(newMessages);
        Assert.Equal(ChatRole.Assistant, message.Role);
        Assert.Equal("Hi there.", message.Text);
    }

    [Fact]
    public void SelectNewOutputMessages_SkipsOnlyTheLatestInputOverlap()
    {
        List<ChatMessage> inputMessages =
        [
            new(ChatRole.Assistant, "Earlier answer"),
            new(ChatRole.User, "Hello"),
        ];
        List<ChatMessage> outputMessages =
        [
            new(ChatRole.User, "Hello"),
            new(ChatRole.Assistant, "Hi there."),
        ];

        IReadOnlyList<ChatMessage> newMessages = CopilotWorkflowRunner.SelectNewOutputMessages(
            outputMessages,
            inputMessages);

        ChatMessage message = Assert.Single(newMessages);
        Assert.Equal(ChatRole.Assistant, message.Role);
        Assert.Equal("Hi there.", message.Text);
    }

    [Fact]
    public void SelectNewOutputMessages_PreservesAssistantOnlyOutput()
    {
        List<ChatMessage> inputMessages =
        [
            new(ChatRole.User, "Hello"),
        ];
        List<ChatMessage> outputMessages =
        [
            new(ChatRole.Assistant, "Hi there."),
        ];

        IReadOnlyList<ChatMessage> newMessages = CopilotWorkflowRunner.SelectNewOutputMessages(
            outputMessages,
            inputMessages);

        ChatMessage message = Assert.Single(newMessages);
        Assert.Equal(ChatRole.Assistant, message.Role);
        Assert.Equal("Hi there.", message.Text);
    }

    [Fact]
    public void ProjectCompletedMessages_FallsBackToStreamingSegmentsWhenWorkflowOutputIsMissing()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-concurrent",
                Name = "Concurrent Brainstorm",
                Mode = "concurrent",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-concurrent-architect", name: "Architect"),
                    CreateAgent(id: "agent-concurrent-implementer", name: "Implementer"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = CopilotWorkflowRunner.ProjectCompletedMessages(
            command,
            [],
            [
                ("msg-1", "Architect", "Architecture reply"),
                ("msg-2", "Implementer", "Implementation reply"),
            ]);

        Assert.Collection(
            messages,
            architect =>
            {
                Assert.Equal("msg-1", architect.Id);
                Assert.Equal("Architect", architect.AuthorName);
                Assert.Equal("Architecture reply", architect.Content);
            },
            implementer =>
            {
                Assert.Equal("msg-2", implementer.Id);
                Assert.Equal("Implementer", implementer.AuthorName);
                Assert.Equal("Implementation reply", implementer.Content);
            });
    }

    [Fact]
    public void ProjectCompletedMessages_CanonicalizesWorkflowOutputAuthorNames()
    {
        RunTurnCommandDto command = new()
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
                    CreateAgent(id: "agent-single-primary", name: "Primary Agent"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = CopilotWorkflowRunner.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "Hello")
                {
                    AuthorName = "assistant",
                },
            ],
            [
                ("msg-1", "Primary Agent", "Hello"),
            ]);

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("msg-1", message.Id);
        Assert.Equal("Primary Agent", message.AuthorName);
        Assert.Equal("Hello", message.Content);
    }

    [Fact]
    public void ProjectCompletedMessages_UsesFallbackAgentForGenericAssistantOutput()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-handoff",
                Name = "Handoff Support Flow",
                Mode = "handoff",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-handoff-triage", name: "Triage"),
                    CreateAgent(id: "agent-handoff-ux", name: "UX Specialist"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = CopilotWorkflowRunner.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, "The button is in place.")
                {
                    AuthorName = "assistant",
                },
            ],
            [],
            new AgentIdentity("agent-handoff-ux", "UX Specialist"));

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("UX Specialist", message.AuthorName);
        Assert.Equal("The button is in place.", message.Content);
    }

    [Fact]
    public void ProjectCompletedMessages_DropsBlankAssistantOutputMessages()
    {
        RunTurnCommandDto command = new()
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-handoff",
                Name = "Handoff Support Flow",
                Mode = "handoff",
                Availability = "available",
                Agents =
                [
                    CreateAgent(id: "agent-handoff-triage", name: "Triage"),
                    CreateAgent(id: "agent-handoff-ux", name: "UX Specialist"),
                ],
            },
        };

        IReadOnlyList<ChatMessageDto> messages = CopilotWorkflowRunner.ProjectCompletedMessages(
            command,
            [
                new ChatMessage(ChatRole.Assistant, string.Empty)
                {
                    AuthorName = "assistant",
                },
                new ChatMessage(ChatRole.Assistant, "Real content")
                {
                    AuthorName = "assistant",
                },
            ],
            [],
            new AgentIdentity("agent-handoff-ux", "UX Specialist"));

        ChatMessageDto message = Assert.Single(messages);
        Assert.Equal("UX Specialist", message.AuthorName);
        Assert.Equal("Real content", message.Content);
    }

    [Fact]
    public void RequiresToolCallApproval_HonorsAutoApprovedToolNames()
    {
        ApprovalPolicyDto policy = new()
        {
            Rules =
            [
                new ApprovalCheckpointRuleDto
                {
                    Kind = "tool-call",
                    AgentIds = ["agent-1"],
                },
            ],
            AutoApprovedToolNames = ["lsp_ts_hover", "web_fetch"],
        };

        Assert.False(CopilotWorkflowRunner.RequiresToolCallApproval(policy, "agent-1", "lsp_ts_hover"));
        Assert.False(CopilotWorkflowRunner.RequiresToolCallApproval(policy, "agent-1", "web_fetch"));
        Assert.True(CopilotWorkflowRunner.RequiresToolCallApproval(policy, "agent-1", "lsp_ts_definition"));
        Assert.True(CopilotWorkflowRunner.RequiresToolCallApproval(policy, "agent-1", null));
        Assert.False(CopilotWorkflowRunner.RequiresToolCallApproval(policy, "agent-2", "lsp_ts_definition"));
    }

    [Fact]
    public void TryGetApprovalToolName_ReadsMcpCustomHookAndUrlRequests()
    {
        Assert.True(
            CopilotWorkflowRunner.TryGetApprovalToolName(
                new PermissionRequestMcp
                {
                    Kind = "mcp",
                    ServerName = "Git MCP",
                    ToolName = "git.status",
                    ToolTitle = "Git Status",
                    ReadOnly = true,
                },
                out string? mcpToolName));
        Assert.Equal("git.status", mcpToolName);

        Assert.True(
            CopilotWorkflowRunner.TryGetApprovalToolName(
                new PermissionRequestCustomTool
                {
                    Kind = "custom tool",
                    ToolName = "lsp_ts_hover",
                    ToolDescription = "Hover information",
                },
                out string? customToolName));
        Assert.Equal("lsp_ts_hover", customToolName);

        Assert.True(
            CopilotWorkflowRunner.TryGetApprovalToolName(
                new PermissionRequestHook
                {
                    Kind = "hook",
                    ToolName = "web_fetch",
                    ToolArgs = """{"url":"https://example.com"}""",
                    HookMessage = "Review required before fetch",
                },
                out string? hookToolName));
        Assert.Equal("web_fetch", hookToolName);

        Assert.True(
            CopilotWorkflowRunner.TryGetApprovalToolName(
                new PermissionRequestUrl
                {
                    Kind = "url",
                    ToolCallId = "tool-call-1",
                    Intention = "Fetch the requested page",
                    Url = "https://example.com/docs",
                },
                out string? urlToolName));
        Assert.Equal("web_fetch", urlToolName);

        Assert.False(
            CopilotWorkflowRunner.TryGetApprovalToolName(
                new PermissionRequestShell
                {
                    Kind = "shell",
                    FullCommandText = "git status",
                    Intention = "Inspect repository state",
                    Commands = [],
                    PossiblePaths = [],
                    PossibleUrls = [],
                    HasWriteFileRedirection = false,
                    CanOfferSessionApproval = false,
                },
                out string? shellToolName));
        Assert.Null(shellToolName);
    }

    [Fact]
    public void BuildPermissionApprovalEvent_IncludesToolContextWhenKnown()
    {
        ApprovalRequestedEventDto approvalEvent = CopilotWorkflowRunner.BuildPermissionApprovalEvent(
            new RunTurnCommandDto
            {
                RequestId = "turn-1",
                SessionId = "session-1",
            },
            CreateAgent("agent-1", "Primary"),
            new PermissionRequestCustomTool
            {
                Kind = "custom tool",
                ToolName = "lsp_ts_hover",
                ToolDescription = "Hover information",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            "approval-1",
            "lsp_ts_hover");

        Assert.Equal("lsp_ts_hover", approvalEvent.ToolName);
        Assert.Equal("Approve lsp_ts_hover", approvalEvent.Title);
        Assert.Contains("tool \"lsp_ts_hover\"", approvalEvent.Detail);
    }

    [Fact]
    public void BuildPermissionApprovalEvent_IncludesRequestedUrlForUrlPermissions()
    {
        ApprovalRequestedEventDto approvalEvent = CopilotWorkflowRunner.BuildPermissionApprovalEvent(
            new RunTurnCommandDto
            {
                RequestId = "turn-1",
                SessionId = "session-1",
            },
            CreateAgent("agent-1", "Analyst"),
            new PermissionRequestUrl
            {
                Kind = "url",
                ToolCallId = "tool-call-1",
                Intention = "Fetch the requested page",
                Url = "https://example.com/docs",
            },
            new PermissionInvocation
            {
                SessionId = "copilot-session-1",
            },
            "approval-1",
            "web_fetch");

        Assert.Equal("web_fetch", approvalEvent.ToolName);
        Assert.Equal("Approve web_fetch", approvalEvent.Title);
        Assert.Contains("url permission", approvalEvent.Detail);
        Assert.Contains("tool \"web_fetch\"", approvalEvent.Detail);
        Assert.Contains("https://example.com/docs", approvalEvent.Detail);
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
}
