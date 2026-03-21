using Kopaya.AgentHost.Contracts;
using Kopaya.AgentHost.Services;
using Microsoft.Extensions.AI;

namespace Kopaya.AgentHost.Tests;

public sealed class CopilotWorkflowRunnerTests
{
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
