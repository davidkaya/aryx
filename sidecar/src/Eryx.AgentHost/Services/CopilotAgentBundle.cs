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
            "single" => AgentWorkflowBuilder.BuildSequential(pattern.Name, Agents),
            "sequential" => AgentWorkflowBuilder.BuildSequential(pattern.Name, Agents),
            "concurrent" => AgentWorkflowBuilder.BuildConcurrent(pattern.Name, Agents),
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
        AIAgent firstAgent = Agents[0];
        PatternAgentDefinitionDto triageDefinition = pattern.Agents[0];
        IReadOnlyList<(AIAgent Agent, PatternAgentDefinitionDto Definition)> specialists =
            Agents.Skip(1)
                .Zip(pattern.Agents.Skip(1), (agent, definition) => (agent, definition))
                .ToList();

        HandoffsWorkflowBuilder builder = AgentWorkflowBuilder.CreateHandoffBuilderWith(firstAgent)
            .WithHandoffInstructions(HandoffWorkflowGuidance.CreateWorkflowInstructions());

        foreach ((AIAgent specialist, PatternAgentDefinitionDto definition) in specialists)
        {
            builder = builder.WithHandoff(
                firstAgent,
                specialist,
                HandoffWorkflowGuidance.CreateForwardReason(definition));
        }

        foreach ((AIAgent specialist, _) in specialists)
        {
            builder = builder.WithHandoff(
                specialist,
                firstAgent,
                HandoffWorkflowGuidance.CreateReturnReason(triageDefinition));
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
            .AddParticipants(Agents.ToArray())
            .Build();
    }
}
