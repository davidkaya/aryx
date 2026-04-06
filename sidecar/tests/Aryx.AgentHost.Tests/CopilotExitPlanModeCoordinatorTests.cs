using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;

namespace Aryx.AgentHost.Tests;

public sealed class CopilotExitPlanModeCoordinatorTests
{
    [Fact]
    public void RecordExitPlanModeRequest_BuildsEventAndMakesItConsumable()
    {
        CopilotExitPlanModeCoordinator coordinator = new();
        RunTurnCommandDto command = CreateCommand();

        ExitPlanModeRequestedEventDto exitPlanEvent = coordinator.RecordExitPlanModeRequest(
            command,
            command.Workflow.GetAgentNodes()[0],
            new ExitPlanModeRequestedEvent
            {
                Data = new ExitPlanModeRequestedData
                {
                    RequestId = "exit-plan-1",
                    Summary = "Proposed plan",
                    PlanContent = "1. Investigate\n2. Implement",
                    Actions = ["interactive", "autopilot"],
                    RecommendedAction = "interactive",
                },
            });

        Assert.Equal("exit-plan-mode-requested", exitPlanEvent.Type);
        Assert.Equal("turn-1", exitPlanEvent.RequestId);
        Assert.Equal("session-1", exitPlanEvent.SessionId);
        Assert.Equal("exit-plan-1", exitPlanEvent.ExitPlanId);
        Assert.Equal("agent-1", exitPlanEvent.AgentId);
        Assert.Equal("Primary", exitPlanEvent.AgentName);
        Assert.Equal("Proposed plan", exitPlanEvent.Summary);
        Assert.Equal("1. Investigate\n2. Implement", exitPlanEvent.PlanContent);
        Assert.Equal(["interactive", "autopilot"], exitPlanEvent.Actions);
        Assert.Equal("interactive", exitPlanEvent.RecommendedAction);

        ExitPlanModeRequestedEventDto? consumed = coordinator.ConsumePendingRequest(command.RequestId);
        Assert.NotNull(consumed);
        Assert.Equal("exit-plan-1", consumed!.ExitPlanId);
        Assert.Null(coordinator.ConsumePendingRequest(command.RequestId));
    }

    private static RunTurnCommandDto CreateCommand()
    {
        return new RunTurnCommandDto
        {
            RequestId = "turn-1",
            SessionId = "session-1",
            Workflow = new WorkflowDefinitionDto
            {
                Id = "workflow-1",
                Name = "Plan Mode Workflow",
                Graph = new WorkflowGraphDto
                {
                    Nodes =
                    [
                        new WorkflowNodeDto
                        {
                            Id = "agent-1",
                            Kind = "agent",
                            Label = "Primary",
                            Config = new WorkflowNodeConfigDto
                            {
                                Kind = "agent",
                                Id = "agent-1",
                                Name = "Primary",
                                Model = "gpt-5.4",
                                Instructions = "Help with the request.",
                            },
                        },
                    ],
                },
                Settings = new WorkflowSettingsDto
                {
                    OrchestrationMode = "single",
                },
            },
        };
    }
}

