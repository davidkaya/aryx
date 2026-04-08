using System.Linq;
using Aryx.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;

namespace Aryx.AgentHost.Services;

internal static class WorkflowOrchestrationFactory
{
    public static HandoffWorkflowBuilder CreateHandoffWorkflowBuilder(
        AIAgent entryAgent,
        HandoffModeSettingsDto? settings = null)
    {
        HandoffModeSettingsDto effectiveSettings = settings ?? new HandoffModeSettingsDto();
        HandoffWorkflowBuilder builder = AgentWorkflowBuilder.CreateHandoffBuilderWith(entryAgent)
            .WithToolCallFilteringBehavior(MapHandoffToolCallFiltering(effectiveSettings.ToolCallFiltering))
            .WithHandoffInstructions(NormalizeOptionalString(effectiveSettings.HandoffInstructions)
                ?? HandoffWorkflowGuidance.CreateWorkflowInstructions());

        if (effectiveSettings.ReturnToPrevious)
        {
            builder = builder.EnableReturnToPrevious();
        }

        return builder;
    }

    public static Workflow CreateHandoffWorkflow(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyList<AIAgent> agents)
    {
        ArgumentNullException.ThrowIfNull(workflowDefinition);
        ArgumentNullException.ThrowIfNull(agents);

        IReadOnlyList<WorkflowNodeDto> agentNodes = workflowDefinition.GetAgentNodes();
        Dictionary<string, AIAgent> agentsById = CreateAgentMap(agents);
        WorkflowNodeDto triageNode = ResolveTriageAgentNode(workflowDefinition, agentNodes);
        AIAgent triageAgent = ResolveAgentForNode(triageNode, agentsById);
        HandoffModeSettingsDto? settings = workflowDefinition.Settings.ModeSettings?.Handoff;
        HandoffWorkflowBuilder builder = CreateHandoffWorkflowBuilder(triageAgent, settings);

        List<WorkflowNodeDto> specialistNodes = agentNodes
            .Where(node => !string.Equals(node.Id, triageNode.Id, StringComparison.Ordinal))
            .ToList();

        if (specialistNodes.Count == 0)
        {
            throw new InvalidOperationException("Handoff workflows require at least one specialist agent in addition to the triage agent.");
        }

        foreach (WorkflowNodeDto specialistNode in specialistNodes)
        {
            AIAgent specialistAgent = ResolveAgentForNode(specialistNode, agentsById);
            builder.WithHandoff(
                triageAgent,
                specialistAgent,
                HandoffWorkflowGuidance.CreateForwardReason(specialistNode));

            if (settings?.ReturnToPrevious != true)
            {
                builder.WithHandoff(
                    specialistAgent,
                    triageAgent,
                    HandoffWorkflowGuidance.CreateReturnReason(triageNode));
            }
        }

        return builder.Build();
    }

    public static GroupChatWorkflowBuilder CreateGroupChatWorkflowBuilder(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyList<AIAgent> agents)
    {
        ArgumentNullException.ThrowIfNull(workflowDefinition);
        ArgumentNullException.ThrowIfNull(agents);

        int maxRounds = ResolveGroupChatMaxRounds(workflowDefinition);
        GroupChatWorkflowBuilder builder = AgentWorkflowBuilder.CreateGroupChatBuilderWith(
            participants => new RoundRobinGroupChatManager(participants)
            {
                MaximumIterationCount = maxRounds,
            })
            .AddParticipants(agents);

        string? name = NormalizeOptionalString(workflowDefinition.Name);
        if (name is not null)
        {
            builder.WithName(name);
        }

        string? description = NormalizeOptionalString(workflowDefinition.Description);
        if (description is not null)
        {
            builder.WithDescription(description);
        }

        return builder;
    }

    public static Workflow CreateGroupChatWorkflow(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyList<AIAgent> agents)
    {
        return CreateGroupChatWorkflowBuilder(workflowDefinition, agents).Build();
    }

    private static Dictionary<string, AIAgent> CreateAgentMap(IReadOnlyList<AIAgent> agents)
    {
        Dictionary<string, AIAgent> agentMap = new(StringComparer.OrdinalIgnoreCase);
        foreach (AIAgent agent in agents)
        {
            if (!string.IsNullOrWhiteSpace(agent.Id))
            {
                agentMap[agent.Id] = agent;
            }

            if (!string.IsNullOrWhiteSpace(agent.Name))
            {
                agentMap[agent.Name] = agent;
            }
        }

        return agentMap;
    }

    private static AIAgent ResolveAgentForNode(
        WorkflowNodeDto node,
        IReadOnlyDictionary<string, AIAgent> agentsById)
    {
        string agentId = node.GetAgentId();
        if (agentsById.TryGetValue(agentId, out AIAgent? agent))
        {
            return agent;
        }

        string agentName = node.GetAgentName();
        if (agentsById.TryGetValue(agentName, out agent))
        {
            return agent;
        }

        throw new InvalidOperationException($"Workflow agent \"{agentId}\" could not be resolved from the constructed agents.");
    }

    private static WorkflowNodeDto ResolveTriageAgentNode(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyList<WorkflowNodeDto> agentNodes)
    {
        if (agentNodes.Count == 0)
        {
            throw new InvalidOperationException("Handoff workflows require at least one agent node.");
        }

        string? triageAgentNodeId = NormalizeOptionalString(workflowDefinition.Settings.ModeSettings?.Handoff?.TriageAgentNodeId);
        if (triageAgentNodeId is null)
        {
            return agentNodes[0];
        }

        WorkflowNodeDto? triageNode = agentNodes.FirstOrDefault(node => string.Equals(node.Id, triageAgentNodeId, StringComparison.Ordinal));
        return triageNode ?? throw new InvalidOperationException(
            $"Handoff workflow triage agent node \"{triageAgentNodeId}\" was not found in the workflow graph.");
    }

    private static HandoffToolCallFilteringBehavior MapHandoffToolCallFiltering(string? value)
    {
        return value?.Trim().ToLowerInvariant() switch
        {
            "none" => HandoffToolCallFilteringBehavior.None,
            "all" => HandoffToolCallFilteringBehavior.All,
            _ => HandoffToolCallFilteringBehavior.HandoffOnly,
        };
    }

    private static int ResolveGroupChatMaxRounds(WorkflowDefinitionDto workflowDefinition)
    {
        int? configuredMaxRounds = workflowDefinition.Settings.ModeSettings?.GroupChat?.MaxRounds;
        if (configuredMaxRounds is > 0)
        {
            return configuredMaxRounds.Value;
        }

        if (workflowDefinition.Settings.MaxIterations is > 0)
        {
            return workflowDefinition.Settings.MaxIterations.Value;
        }

        return 5;
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
