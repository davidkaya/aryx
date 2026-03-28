using System.Threading;
using GitHub.Copilot.SDK;
using Aryx.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.GitHub.Copilot;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Agents.AI.Workflows.Specialized;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

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
        Func<PatternAgentDefinitionDto, UserInputRequest, UserInputInvocation, Task<UserInputResponse>> onUserInputRequest,
        Action<PatternAgentDefinitionDto, SessionEvent>? onSessionEvent,
        CancellationToken cancellationToken)
    {
        List<IAsyncDisposable> disposables = [];
        List<AIAgent> agents = [];
        CopilotClientOptions clientOptions = CopilotCliPathResolver.CreateClientOptions();
        ResolvedHookSet configuredHooks = await HookConfigLoader.LoadAsync(command.ProjectPath, cancellationToken)
            .ConfigureAwait(false);
        IHookCommandRunner hookCommandRunner = HookCommandRunner.Instance;
        SessionToolingBundle? toolingBundle = command.Tooling is null
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

            SessionConfig sessionConfig = CreateSessionConfig(
                command,
                definition,
                agentIndex,
                (request, invocation) => onPermissionRequest(definition, request, invocation),
                (request, invocation) => onUserInputRequest(definition, request, invocation),
                evt => onSessionEvent?.Invoke(definition, evt),
                configuredHooks,
                hookCommandRunner);

            ApplySessionTooling(sessionConfig, toolingBundle?.McpServers, toolingBundle?.Tools);

            AryxCopilotAgent agent = new(
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

    internal static SessionConfig CreateSessionConfig(
        RunTurnCommandDto command,
        PatternAgentDefinitionDto definition,
        int agentIndex,
        PermissionRequestHandler? onPermissionRequest = null,
        UserInputHandler? onUserInputRequest = null,
        SessionEventHandler? onSessionEvent = null,
        ResolvedHookSet? configuredHooks = null,
        IHookCommandRunner? hookCommandRunner = null)
    {
        // Let the Copilot SDK allocate session IDs. Explicit custom SessionId values currently
        // cause turns to complete without assistant output, even for simple single-agent prompts.
        return new SessionConfig
        {
            Model = definition.Model,
            ReasoningEffort = definition.ReasoningEffort,
            SystemMessage = new SystemMessageConfig
            {
                Content = AgentInstructionComposer.Compose(
                    command.Pattern,
                    definition,
                    agentIndex,
                    command.WorkspaceKind,
                    command.Mode),
            },
            WorkingDirectory = command.ProjectPath,
            OnPermissionRequest = onPermissionRequest,
            OnUserInputRequest = onUserInputRequest,
            Hooks = CopilotSessionHooks.Create(command, definition, configuredHooks, hookCommandRunner),
            OnEvent = onSessionEvent,
            Streaming = true,
            CustomAgents = CreateCustomAgents(definition.Copilot?.CustomAgents),
            Agent = NormalizeOptionalString(definition.Copilot?.Agent),
            SkillDirectories = CreateStringList(definition.Copilot?.SkillDirectories),
            DisabledSkills = CreateStringList(definition.Copilot?.DisabledSkills),
            InfiniteSessions = CreateInfiniteSessions(definition.Copilot?.InfiniteSessions),
        };
    }

    internal static void ApplySessionTooling(
        SessionConfig sessionConfig,
        Dictionary<string, object>? mcpServers,
        IReadOnlyList<AIFunction>? tools)
    {
        if (mcpServers is { Count: > 0 })
        {
            sessionConfig.McpServers = mcpServers;
        }

        if (tools is { Count: > 0 })
        {
            sessionConfig.Tools = tools.ToList();
        }
    }

    internal static List<CustomAgentConfig>? CreateCustomAgents(
        IReadOnlyList<RunTurnCustomAgentConfigDto>? customAgents)
    {
        if (customAgents is not { Count: > 0 })
        {
            return null;
        }

        return customAgents.Select(customAgent => new CustomAgentConfig
        {
            Name = customAgent.Name,
            DisplayName = NormalizeOptionalString(customAgent.DisplayName),
            Description = NormalizeOptionalString(customAgent.Description),
            Tools = customAgent.Tools is null ? null : [.. customAgent.Tools],
            Prompt = customAgent.Prompt,
            McpServers = customAgent.McpServers.Count == 0
                ? null
                : SessionToolingBundle.BuildMcpServerConfigurations(customAgent.McpServers),
            Infer = customAgent.Infer,
        }).ToList();
    }

    internal static InfiniteSessionConfig? CreateInfiniteSessions(RunTurnInfiniteSessionsConfigDto? config)
    {
        if (config is null)
        {
            return null;
        }

        return new InfiniteSessionConfig
        {
            Enabled = config.Enabled,
            BackgroundCompactionThreshold = config.BackgroundCompactionThreshold,
            BufferExhaustionThreshold = config.BufferExhaustionThreshold,
        };
    }

    private static List<string>? CreateStringList(IReadOnlyList<string>? values)
    {
        return values is { Count: > 0 }
            ? [.. values]
            : null;
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
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
        string entryAgentId = agentMap.ContainsKey(topology.EntryAgentId)
            ? topology.EntryAgentId
            : pattern.Agents.FirstOrDefault()?.Id ?? topology.EntryAgentId;
        AIAgent entryAgent = agentMap.GetValueOrDefault(entryAgentId) ?? Agents[0];

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

            string handoffReason = string.Equals(
                route.TargetAgentId,
                topology.EntryAgentId,
                StringComparison.Ordinal)
                ? HandoffWorkflowGuidance.CreateReturnReason(targetDefinition)
                : HandoffWorkflowGuidance.CreateForwardReason(targetDefinition);

            builder = builder.WithHandoff(
                sourceAgent,
                targetAgent,
                handoffReason);
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
