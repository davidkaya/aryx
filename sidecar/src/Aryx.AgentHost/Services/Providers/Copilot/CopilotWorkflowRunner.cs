using System.IO;
using System.Text.Json;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Agents.AI.Workflows.Checkpointing;
using Microsoft.Agents.AI.Workflows.InProc;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

public sealed class CopilotWorkflowRunner : AgentWorkflowTurnRunner
{
    public CopilotWorkflowRunner(WorkflowValidator? workflowValidator = null)
        : base(new CopilotTurnRunnerSupport(), workflowValidator)
    {
    }

    internal new static Workflow BuildWorkflowForCommand(
        RunTurnCommandDto command,
        IReadOnlyList<AIAgent> agents,
        WorkflowRunner? workflowRunner = null)
    {
        return AgentWorkflowTurnRunner.BuildWorkflowForCommand(command, agents, workflowRunner);
    }

    internal new static FileSystemJsonCheckpointStore? CreateCheckpointStore(RunTurnCommandDto command)
    {
        return AgentWorkflowTurnRunner.CreateCheckpointStore(command);
    }

    internal new static bool ShouldEnableWorkflowCheckpointing(RunTurnCommandDto command)
    {
        return AgentWorkflowTurnRunner.ShouldEnableWorkflowCheckpointing(command);
    }

    internal new static string GetCheckpointStorePath(RunTurnCommandDto command)
    {
        return AgentWorkflowTurnRunner.GetCheckpointStorePath(command);
    }

    internal new static InProcessExecutionEnvironment CreateExecutionEnvironment(
        RunTurnCommandDto command,
        CheckpointManager? checkpointManager)
    {
        return AgentWorkflowTurnRunner.CreateExecutionEnvironment(command, checkpointManager);
    }

    internal static void ConfigureHookLifecycleEventSuppression(
        CopilotTurnExecutionState state,
        CopilotAgentBundle bundle)
    {
        AgentWorkflowTurnRunner.ConfigureHookLifecycleEventSuppression(state, bundle);
    }

    internal new static UserInputRequest CreateRequestPortUserInputRequest(
        AgentWorkflowTurnRunner.WorkflowRequestPortMetadata metadata,
        RequestInfoEvent requestInfo)
    {
        return AgentWorkflowTurnRunner.CreateRequestPortUserInputRequest(metadata, requestInfo);
    }

    internal new static object CoerceRequestPortResponse(string responseType, string? answer)
    {
        return AgentWorkflowTurnRunner.CoerceRequestPortResponse(responseType, answer);
    }

    private static Task<bool> HandleWorkflowEventAsync(
        RunTurnCommandDto command,
        WorkflowEvent evt,
        IReadOnlyList<ChatMessage> inputMessages,
        CopilotTurnExecutionState state,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<SidecarEventDto, Task> onEvent)
    {
        return AgentWorkflowTurnRunner.HandleWorkflowEventAsync(
            command,
            evt,
            inputMessages,
            state,
            CopilotTranscriptProjector.Instance,
            onDelta,
            onEvent);
    }
}
