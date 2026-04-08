using System.Linq;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.GitHub.Copilot;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotAgentBundle : ProviderAgentBundle
{
    private static readonly string[] RequiredPromptTools =
    [
        "ask_user",
        "report_intent",
        "task_complete"
    ];
    private const string HandoffToolPrefix = "handoff_to_";
    private readonly List<IAsyncDisposable> _disposables = [];

    internal CopilotAgentBundle(IReadOnlyList<AIAgent> agents, bool hasConfiguredHooks)
    {
        Agents = agents;
        HasConfiguredHooks = hasConfiguredHooks;
    }

    public override IReadOnlyList<AIAgent> Agents { get; }

    public override bool HasConfiguredHooks { get; }

    public override IProviderTranscriptProjector TranscriptProjector { get; } = CopilotTranscriptProjector.Instance;

    public static async Task<CopilotAgentBundle> CreateAsync(
        RunTurnCommandDto command,
        Func<WorkflowNodeDto, PermissionRequest, PermissionInvocation, Task<PermissionRequestResult>> onPermissionRequest,
        Func<WorkflowNodeDto, UserInputRequest, UserInputInvocation, Task<UserInputResponse>> onUserInputRequest,
        Action<WorkflowNodeDto, SessionEvent>? onSessionEvent,
        CancellationToken cancellationToken)
    {
        List<IAsyncDisposable> disposables = [];
        List<AIAgent> agents = [];
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

        IReadOnlyList<WorkflowNodeDto> agentNodes = command.Workflow.GetAllAgentNodes(command.WorkflowLibrary);

        if (agentNodes.Count > 0)
        {
            CopilotClientOptions clientOptions = CopilotCliPathResolver.CreateClientOptions();

            // Share a single CopilotClient across all agents to avoid spawning
            // multiple CLI processes that race on token refresh during auto-login.
            CopilotClient sharedClient = new(clientOptions);
            await sharedClient.StartAsync(cancellationToken).ConfigureAwait(false);

            foreach ((WorkflowNodeDto definition, int agentIndex) in agentNodes.Select((definition, index) => (definition, index)))
            {
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
                ApplyPromptInvocation(sessionConfig, command.PromptInvocation);

                AryxCopilotAgent agent = new(
                    sharedClient,
                    sessionConfig,
                    ownsClient: false,
                    id: definition.GetAgentId(),
                    name: definition.GetAgentName(),
                    description: NormalizeOptionalString(definition.Config.Description));

                agents.Add(agent);
                disposables.Add(agent);
            }

            // The bundle owns the shared client — disposed after all agents.
            disposables.Add(sharedClient);
        }

        CopilotAgentBundle bundle = new(agents, hasConfiguredHooks: !configuredHooks.IsEmpty);
        bundle._disposables.AddRange(disposables);
        return bundle;
    }

    internal static SessionConfig CreateSessionConfig(
        RunTurnCommandDto command,
        WorkflowNodeDto definition,
        int agentIndex,
        PermissionRequestHandler? onPermissionRequest = null,
        UserInputHandler? onUserInputRequest = null,
        SessionEventHandler? onSessionEvent = null,
        ResolvedHookSet? configuredHooks = null,
        IHookCommandRunner? hookCommandRunner = null)
    {
        return new SessionConfig
        {
            Model = definition.Config.Model,
            ReasoningEffort = definition.Config.ReasoningEffort,
            SystemMessage = new SystemMessageConfig
            {
                Content = AgentInstructionComposer.Compose(
                    command.Workflow,
                    definition,
                    agentIndex,
                    command.WorkspaceKind,
                    command.Mode,
                    command.ProjectInstructions,
                    command.PromptInvocation),
            },
            WorkingDirectory = command.ProjectPath,
            OnPermissionRequest = onPermissionRequest,
            OnUserInputRequest = onUserInputRequest,
            Hooks = CopilotSessionHooks.Create(command, definition, configuredHooks, hookCommandRunner),
            OnEvent = onSessionEvent,
            Streaming = true,
            CustomAgents = CreateCustomAgents(definition.Config.Copilot?.CustomAgents),
            Agent = ResolveEffectiveAgent(definition.Config.Copilot?.Agent, command.PromptInvocation),
            SkillDirectories = CreateStringList(definition.Config.Copilot?.SkillDirectories),
            DisabledSkills = CreateStringList(definition.Config.Copilot?.DisabledSkills),
            InfiniteSessions = CreateInfiniteSessions(definition.Config.Copilot?.InfiniteSessions),
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

    internal static void ApplyPromptInvocation(
        SessionConfig sessionConfig,
        RunTurnPromptInvocationDto? promptInvocation)
    {
        IReadOnlyList<string>? allowedTools = NormalizeToolNames(promptInvocation?.Tools);
        if (allowedTools is null)
        {
            return;
        }

        sessionConfig.AvailableTools = BuildAvailableTools(sessionConfig.AvailableTools, allowedTools);

        if (sessionConfig.Tools is null)
        {
            return;
        }

        List<AIFunction> filteredTools = sessionConfig.Tools
            .Where(tool => IsAlwaysAllowedTool(tool.Name) || allowedTools.Contains(tool.Name, StringComparer.OrdinalIgnoreCase))
            .ToList();
        sessionConfig.Tools = filteredTools.Count > 0 ? filteredTools : null;
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

    internal static AIAgentHostOptions CreateAgentHostOptions()
    {
        return AgentHostOptionsFactory.CreateDefault();
    }

    internal static HandoffWorkflowBuilder CreateHandoffWorkflowBuilder(
        AIAgent entryAgent,
        HandoffModeSettingsDto? settings = null)
    {
        return WorkflowOrchestrationFactory.CreateHandoffWorkflowBuilder(entryAgent, settings);
    }

    internal static Workflow CreateHandoffWorkflow(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyList<AIAgent> agents)
    {
        return WorkflowOrchestrationFactory.CreateHandoffWorkflow(workflowDefinition, agents);
    }

    internal static GroupChatWorkflowBuilder CreateGroupChatWorkflowBuilder(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyList<AIAgent> agents)
    {
        return WorkflowOrchestrationFactory.CreateGroupChatWorkflowBuilder(workflowDefinition, agents);
    }

    internal static Workflow CreateGroupChatWorkflow(
        WorkflowDefinitionDto workflowDefinition,
        IReadOnlyList<AIAgent> agents)
    {
        return WorkflowOrchestrationFactory.CreateGroupChatWorkflow(workflowDefinition, agents);
    }

    public override async ValueTask DisposeAsync()
    {
        foreach (IAsyncDisposable disposable in _disposables)
        {
            await disposable.DisposeAsync().ConfigureAwait(false);
        }
    }

    private static List<string>? CreateStringList(IReadOnlyList<string>? values)
    {
        return values is { Count: > 0 }
            ? [.. values]
            : null;
    }

    private static List<string> BuildAvailableTools(
        ICollection<string>? existingAvailableTools,
        IReadOnlyList<string> allowedTools)
    {
        List<string> availableTools = existingAvailableTools is { Count: > 0 }
            ? existingAvailableTools
                .Where(tool => allowedTools.Contains(tool, StringComparer.OrdinalIgnoreCase))
                .ToList()
            : [.. allowedTools];

        foreach (string requiredTool in RequiredPromptTools)
        {
            if (!availableTools.Contains(requiredTool, StringComparer.OrdinalIgnoreCase))
            {
                availableTools.Add(requiredTool);
            }
        }

        return availableTools;
    }

    private static bool IsAlwaysAllowedTool(string toolName)
    {
        return toolName.StartsWith(HandoffToolPrefix, StringComparison.Ordinal)
            || RequiredPromptTools.Contains(toolName, StringComparer.OrdinalIgnoreCase);
    }

    private static IReadOnlyList<string>? NormalizeToolNames(IReadOnlyList<string>? values)
    {
        if (values is null)
        {
            return null;
        }

        return values
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string? ResolveEffectiveAgent(
        string? defaultAgent,
        RunTurnPromptInvocationDto? promptInvocation)
    {
        string? promptAgent = NormalizeOptionalString(promptInvocation?.Agent);
        if (!string.IsNullOrWhiteSpace(promptAgent)
            && !string.Equals(promptAgent, "plan", StringComparison.OrdinalIgnoreCase))
        {
            return promptAgent;
        }

        IReadOnlyList<string>? promptTools = NormalizeToolNames(promptInvocation?.Tools);
        if (promptTools is { Count: > 0 })
        {
            return "agent";
        }

        return NormalizeOptionalString(defaultAgent);
    }

    private static string? NormalizeOptionalString(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
