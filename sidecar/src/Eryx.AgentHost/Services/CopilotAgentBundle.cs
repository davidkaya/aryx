using GitHub.Copilot.SDK;
using Eryx.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.GitHub.Copilot;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Agents.AI.Workflows.Specialized;
using Microsoft.Extensions.AI;

namespace Eryx.AgentHost.Services;

internal sealed class CopilotAgentBundle : IAsyncDisposable
{
    private readonly List<IAsyncDisposable> _disposables = [];

    private CopilotAgentBundle(IReadOnlyList<AIAgent> agents)
    {
        Agents = agents;
    }

    public IReadOnlyList<AIAgent> Agents { get; }

    public static async Task<CopilotAgentBundle> CreateAsync(
        RunTurnCommandDto command,
        Func<PatternAgentDefinitionDto, PermissionRequest, PermissionInvocation, Task<PermissionRequestResult>> onPermissionRequest,
        CancellationToken cancellationToken)
    {
        List<IAsyncDisposable> disposables = [];
        List<AIAgent> agents = [];
        CopilotClientOptions clientOptions = CopilotCliPathResolver.CreateClientOptions();
        bool isScratchpad = string.Equals(command.WorkspaceKind, "scratchpad", StringComparison.OrdinalIgnoreCase);
        SessionToolingBundle? toolingBundle = isScratchpad
            ? null
            : await SessionToolingBundle.CreateAsync(command.Tooling, command.ProjectPath, cancellationToken)
                .ConfigureAwait(false);

        if (toolingBundle is not null)
        {
            disposables.Add(toolingBundle);
        }

        foreach ((PatternAgentDefinitionDto definition, int agentIndex) in command.Pattern.Agents.Select((definition, index) => (definition, index)))
        {
            CopilotClient client = new(clientOptions);
            await client.StartAsync(cancellationToken).ConfigureAwait(false);

            SessionConfig sessionConfig = new()
            {
                Model = definition.Model,
                ReasoningEffort = definition.ReasoningEffort,
                SystemMessage = new SystemMessageConfig
                {
                    Content = AgentInstructionComposer.Compose(command.Pattern, definition, agentIndex, command.WorkspaceKind),
                },
                WorkingDirectory = command.ProjectPath,
                OnPermissionRequest = (request, invocation) => onPermissionRequest(definition, request, invocation),
                Streaming = true,
            };

            if (isScratchpad)
            {
                sessionConfig.AvailableTools = [];
            }
            else if (toolingBundle is not null)
            {
                if (toolingBundle.McpServers.Count > 0)
                {
                    sessionConfig.McpServers = toolingBundle.McpServers;
                }

                if (toolingBundle.Tools.Count > 0)
                {
                    sessionConfig.Tools = toolingBundle.Tools.ToList();
                }
            }

            GitHubCopilotAgent agent = new(
                client,
                sessionConfig,
                ownsClient: true,
                id: definition.Id,
                name: definition.Name,
                description: definition.Description);

            agents.Add(agent);
            disposables.Add(agent);
        }

        CopilotAgentBundle bundle = new(agents);
        bundle._disposables.AddRange(disposables);
        return bundle;
    }

    public Workflow BuildWorkflow(PatternDefinitionDto pattern)
    {
        return pattern.Mode switch
        {
            "single" => AgentWorkflowBuilder.BuildSequential(pattern.Name, ResolveOrderedAgents(pattern)),
            "sequential" => AgentWorkflowBuilder.BuildSequential(pattern.Name, ResolveOrderedAgents(pattern)),
            "concurrent" => AgentWorkflowBuilder.BuildConcurrent(pattern.Name, ResolveOrderedAgents(pattern)),
            "handoff" => BuildHandoffWorkflow(pattern),
            "group-chat" => BuildGroupChatWorkflow(pattern),
            "magentic" => throw new NotSupportedException(
                pattern.UnavailabilityReason
                ?? "Magentic orchestration is not yet supported in the .NET Agent Framework."),
            _ => throw new NotSupportedException($"Unsupported orchestration mode '{pattern.Mode}'."),
        };
    }

    public async ValueTask DisposeAsync()
    {
        foreach (IAsyncDisposable disposable in _disposables)
        {
            await disposable.DisposeAsync().ConfigureAwait(false);
        }
    }

    private Workflow BuildHandoffWorkflow(PatternDefinitionDto pattern)
    {
        Dictionary<string, AIAgent> agentMap = BuildAgentMap(pattern);
        Dictionary<string, PatternAgentDefinitionDto> definitionMap = pattern.Agents.ToDictionary(
            definition => definition.Id,
            definition => definition,
            StringComparer.Ordinal);
        PatternHandoffTopology topology = PatternGraphResolver.ResolveHandoff(pattern);
        AIAgent entryAgent = agentMap.GetValueOrDefault(topology.EntryAgentId) ?? Agents[0];

        HandoffsWorkflowBuilder builder = AgentWorkflowBuilder.CreateHandoffBuilderWith(entryAgent)
            .WithHandoffInstructions(HandoffWorkflowGuidance.CreateWorkflowInstructions());

        foreach (PatternHandoffRoute route in topology.Routes)
        {
            if (!agentMap.TryGetValue(route.SourceAgentId, out AIAgent? sourceAgent)
                || !agentMap.TryGetValue(route.TargetAgentId, out AIAgent? targetAgent)
                || !definitionMap.TryGetValue(route.TargetAgentId, out PatternAgentDefinitionDto? targetDefinition))
            {
                continue;
            }

            builder = builder.WithHandoff(
                sourceAgent,
                targetAgent,
                HandoffWorkflowGuidance.CreateForwardReason(targetDefinition));
        }

        return builder.Build();
    }

    private Workflow BuildGroupChatWorkflow(PatternDefinitionDto pattern)
    {
        int maximumIterations = pattern.MaxIterations <= 0 ? 5 : pattern.MaxIterations;

        return AgentWorkflowBuilder
            .CreateGroupChatBuilderWith(agents =>
                new RoundRobinGroupChatManager(agents)
                {
                    MaximumIterationCount = maximumIterations,
                })
            .AddParticipants(ResolveOrderedAgents(pattern).ToArray())
            .Build();
    }

    private IReadOnlyList<AIAgent> ResolveOrderedAgents(PatternDefinitionDto pattern)
    {
        Dictionary<string, AIAgent> agentMap = BuildAgentMap(pattern);
        List<AIAgent> orderedAgents = PatternGraphResolver.ResolveOrderedAgentIds(pattern)
            .Select(agentId => agentMap.TryGetValue(agentId, out AIAgent? agent) ? agent : null)
            .Where(agent => agent is not null)
            .Cast<AIAgent>()
            .ToList();

        return orderedAgents.Count == Agents.Count ? orderedAgents : Agents;
    }

    private Dictionary<string, AIAgent> BuildAgentMap(PatternDefinitionDto pattern)
    {
        Dictionary<string, AIAgent> agentMap = new(StringComparer.Ordinal);
        foreach ((PatternAgentDefinitionDto definition, AIAgent agent) in pattern.Agents.Zip(Agents))
        {
            agentMap[definition.Id] = agent;
        }

        return agentMap;
    }
}
