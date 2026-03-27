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
    private const string HandoffToolPrefix = "handoff_to_";
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

            SessionConfig sessionConfig = new()
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
                OnPermissionRequest = (request, invocation) => onPermissionRequest(definition, request, invocation),
                OnUserInputRequest = (request, invocation) => onUserInputRequest(definition, request, invocation),
                OnEvent = evt => onSessionEvent?.Invoke(definition, evt),
                Streaming = true,
            };

            if (IsInitialHandoffAgent(command.Pattern, agentIndex))
            {
                ApplyInitialHandoffEntryConstraints(sessionConfig);
            }
            else
            {
                ApplySessionTooling(sessionConfig, toolingBundle?.McpServers, toolingBundle?.Tools);
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

    internal static void ApplyInitialHandoffEntryConstraints(SessionConfig sessionConfig)
    {
        sessionConfig.AvailableTools = [];
        sessionConfig.ExcludedTools = null;
        sessionConfig.McpServers = null;
        sessionConfig.Tools = null;
    }

    internal static AgentRunOptions? RequireInitialHandoffToolMode(AgentRunOptions? options)
    {
        if (options is not ChatClientAgentRunOptions chatRunOptions
            || chatRunOptions.ChatOptions?.Tools is not { Count: > 0 } tools
            || !tools.Any(IsHandoffTool))
        {
            return options;
        }

        ChatClientAgentRunOptions constrainedOptions = (ChatClientAgentRunOptions)chatRunOptions.Clone();
        constrainedOptions.ChatOptions ??= new ChatOptions();
        constrainedOptions.ChatOptions.ToolMode ??= ChatToolMode.RequireAny;
        return constrainedOptions;
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
        AIAgent entryAgent = WrapInitialHandoffEntryAgent(agentMap.GetValueOrDefault(entryAgentId) ?? Agents[0]);
        if (!string.IsNullOrWhiteSpace(entryAgentId))
        {
            agentMap[entryAgentId] = entryAgent;
        }

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

    private static bool IsInitialHandoffAgent(PatternDefinitionDto pattern, int agentIndex)
    {
        return agentIndex == 0
            && string.Equals(pattern.Mode, "handoff", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsHandoffTool(AITool tool)
    {
        return !string.IsNullOrWhiteSpace(tool.Name)
            && tool.Name.StartsWith(HandoffToolPrefix, StringComparison.Ordinal);
    }

    private static AIAgent WrapInitialHandoffEntryAgent(AIAgent agent)
    {
        int streamingInvocationCount = 0;
        return agent.AsBuilder()
            .Use(
                runFunc: null,
                runStreamingFunc: (messages, session, options, innerAgent, cancellationToken) =>
                {
                    AgentRunOptions? effectiveOptions = Interlocked.Increment(ref streamingInvocationCount) == 1
                        ? RequireInitialHandoffToolMode(options)
                        : options;
                    return innerAgent.RunStreamingAsync(messages, session, effectiveOptions, cancellationToken);
                })
            .Build();
    }
}
