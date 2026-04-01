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

    internal CopilotAgentBundle(IReadOnlyList<AIAgent> agents, bool hasConfiguredHooks)
    {
        Agents = agents;
        HasConfiguredHooks = hasConfiguredHooks;
    }

    public IReadOnlyList<AIAgent> Agents { get; }

    public bool HasConfiguredHooks { get; }

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

        CopilotAgentBundle bundle = new(agents, hasConfiguredHooks: !configuredHooks.IsEmpty);
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
                    command.Mode,
                    command.ProjectInstructions),
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
            "single" => BuildSequentialWorkflow(pattern),
            "sequential" => BuildSequentialWorkflow(pattern),
            "concurrent" => BuildConcurrentWorkflow(pattern),
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

        HandoffsWorkflowBuilder builder = CreateHandoffWorkflowBuilder(entryAgent);

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

    internal static AIAgentHostOptions CreateAgentHostOptions()
    {
        return new AIAgentHostOptions
        {
            // Aryx controls per-turn streaming with TurnToken(emitEvents: true), so keep this
            // null to preserve that behavior while making the host defaults explicit in code.
            EmitAgentUpdateEvents = null,
            // Aryx already projects streamed transcript state itself; enabling this would add
            // extra response events that need separate reconciliation first.
            EmitAgentResponseEvents = false,
            InterceptUserInputRequests = false,
            InterceptUnterminatedFunctionCalls = false,
            ReassignOtherAgentsAsUsers = true,
            ForwardIncomingMessages = true,
        };
    }

    internal static HandoffsWorkflowBuilder CreateHandoffWorkflowBuilder(AIAgent entryAgent)
    {
        return AgentWorkflowBuilder.CreateHandoffBuilderWith(entryAgent)
            // Preserve normal tool-call history across handoffs while still hiding the
            // workflow's handoff plumbing. Make this explicit so AF default changes
            // cannot silently alter Aryx handoff behavior.
            .WithToolCallFilteringBehavior(HandoffToolCallFilteringBehavior.HandoffOnly)
            .WithHandoffInstructions(HandoffWorkflowGuidance.CreateWorkflowInstructions());
    }

    private Workflow BuildSequentialWorkflow(PatternDefinitionDto pattern)
    {
        IReadOnlyList<AIAgent> agents = ResolveOrderedAgents(pattern);
        List<ExecutorBinding> agentExecutors = agents
            .Select(CreateAgentExecutorBinding)
            .ToList();

        ExecutorBinding previous = agentExecutors[0];
        WorkflowBuilder builder = new(previous);

        foreach (ExecutorBinding next in agentExecutors.Skip(1))
        {
            builder.AddEdge(previous, next);
            previous = next;
        }

        WorkflowOutputMessagesExecutor end = new();
        builder = builder.AddEdge(previous, end).WithOutputFrom(end);

        if (pattern.Name is not null)
        {
            builder = builder.WithName(pattern.Name);
        }

        return builder.Build();
    }

    private Workflow BuildConcurrentWorkflow(PatternDefinitionDto pattern)
    {
        IReadOnlyList<AIAgent> agents = ResolveOrderedAgents(pattern);
        ChatForwardingExecutor start = new("Start");
        WorkflowBuilder builder = new(start);

        ExecutorBinding[] agentExecutors = agents
            .Select(CreateAgentExecutorBinding)
            .ToArray();
        ExecutorBinding[] accumulators = agentExecutors
            .Select(executor => CreateAggregateMessagesExecutorBinding($"Batcher/{executor.Id}"))
            .ToArray();

        builder.AddFanOutEdge(start, agentExecutors);

        for (int index = 0; index < agentExecutors.Length; index++)
        {
            builder.AddEdge(agentExecutors[index], accumulators[index]);
        }

        Func<string, string, ValueTask<WorkflowConcurrentEndExecutor>> endFactory =
            (_, __) => new(new WorkflowConcurrentEndExecutor(agentExecutors.Length, AggregateConcurrentResults));
        ExecutorBinding end = endFactory.BindExecutor(WorkflowConcurrentEndExecutor.ExecutorId);

        builder.AddFanInBarrierEdge(accumulators, end);
        builder = builder.WithOutputFrom(end);

        if (pattern.Name is not null)
        {
            builder = builder.WithName(pattern.Name);
        }

        return builder.Build();
    }

    private Workflow BuildGroupChatWorkflow(PatternDefinitionDto pattern)
    {
        int maximumIterations = pattern.MaxIterations <= 0 ? 5 : pattern.MaxIterations;
        AIAgent[] agents = ResolveOrderedAgents(pattern).ToArray();
        Dictionary<AIAgent, ExecutorBinding> agentMap = agents.ToDictionary(
            agent => agent,
            CreateAgentExecutorBinding);

        Func<string, string, ValueTask<WorkflowRoundRobinGroupChatHost>> groupChatHostFactory =
            (id, _) => new(new WorkflowRoundRobinGroupChatHost(
                id,
                agents,
                agentMap,
                maximumIterations));

        ExecutorBinding host = groupChatHostFactory.BindExecutor("GroupChatHost");
        WorkflowBuilder builder = new(host);

        foreach (ExecutorBinding participant in agentMap.Values)
        {
            builder
                .AddEdge(host, participant)
                .AddEdge(participant, host);
        }

        return builder.WithOutputFrom(host).Build();
    }

    private static ExecutorBinding CreateAgentExecutorBinding(AIAgent agent)
        => agent.BindAsExecutor(CreateAgentHostOptions());

    private static ExecutorBinding CreateAggregateMessagesExecutorBinding(string id)
    {
        Func<string, string, ValueTask<WorkflowAggregateTurnMessagesExecutor>> factory =
            (_, __) => new(new WorkflowAggregateTurnMessagesExecutor(id));
        return factory.BindExecutor(id);
    }

    private static List<ChatMessage> AggregateConcurrentResults(IList<List<ChatMessage>> lists)
        => [.. from list in lists where list.Count > 0 select list.Last()];

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
