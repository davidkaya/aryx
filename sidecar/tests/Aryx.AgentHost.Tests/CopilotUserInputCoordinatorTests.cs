using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotUserInputCoordinatorTests
{
    [Fact]
    public async Task RequestUserInputAsync_RaisesUserInputEventAndCompletesAfterResolution()
    {
        CopilotUserInputCoordinator coordinator = new();
        UserInputRequestedEventDto? observedEvent = null;
        RunTurnCommandDto command = CreateUserInputCommand();

        Task<UserInputResponse> pending = coordinator.RequestUserInputAsync(
            command,
            command.Pattern.Agents[0],
            new UserInputRequest
            {
                Question = "How should I proceed?",
                Choices = ["Continue", "Stop"],
                AllowFreeform = true,
            },
            new UserInputInvocation
            {
                SessionId = "copilot-session-1",
            },
            userInputEvent =>
            {
                observedEvent = userInputEvent;
                return Task.CompletedTask;
            },
            CancellationToken.None);

        Assert.False(pending.IsCompleted);
        Assert.NotNull(observedEvent);
        Assert.Equal("user-input-requested", observedEvent!.Type);
        Assert.Equal("turn-1", observedEvent.RequestId);
        Assert.Equal("session-1", observedEvent.SessionId);
        Assert.Equal("agent-1", observedEvent.AgentId);
        Assert.Equal("Primary", observedEvent.AgentName);
        Assert.Equal("How should I proceed?", observedEvent.Question);
        Assert.Equal(["Continue", "Stop"], observedEvent.Choices);
        Assert.True(observedEvent.AllowFreeform);

        await coordinator.ResolveUserInputAsync(
            new ResolveUserInputCommandDto
            {
                UserInputId = observedEvent.UserInputId,
                Answer = "Continue",
                WasFreeform = false,
            },
            CancellationToken.None);

        UserInputResponse response = await pending;
        Assert.Equal("Continue", response.Answer);
        Assert.False(response.WasFreeform);
    }

    [Fact]
    public async Task ResolveUserInputAsync_RejectsUnknownUserInputIds()
    {
        CopilotUserInputCoordinator coordinator = new();

        InvalidOperationException error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            coordinator.ResolveUserInputAsync(
                new ResolveUserInputCommandDto
                {
                    UserInputId = "user-input-missing",
                    Answer = "Continue",
                    WasFreeform = false,
                },
                CancellationToken.None));

        Assert.Contains("is not pending", error.Message);
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

    private static RunTurnCommandDto CreateUserInputCommand()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Pattern = new PatternDefinitionDto
            {
                Id = "pattern-1",
                Name = "User Input Pattern",
                Mode = "single",
                Availability = "available",
                Agents =
                [
                    CreateAgent("agent-1", "Primary"),
                ],
            },
        };
    }
}
