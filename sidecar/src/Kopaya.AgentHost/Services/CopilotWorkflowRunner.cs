using System.Text;
using GitHub.Copilot.SDK;
using Kopaya.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.GitHub.Copilot;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Agents.AI.Workflows.Specialized;
using Microsoft.Extensions.AI;

namespace Kopaya.AgentHost.Services;

public sealed class CopilotWorkflowRunner : ITurnWorkflowRunner
{
    private static readonly Type? HandoffTargetType = LoadType(
        "Microsoft.Agents.AI.Workflows.Specialized.HandoffTarget, Microsoft.Agents.AI.Workflows");
    private static readonly Type? FunctionCallContentType = LoadType(
        "Microsoft.Extensions.AI.FunctionCallContent, Microsoft.Extensions.AI.Abstractions");
    private static readonly Type? McpServerToolCallContentType = LoadType(
        "Microsoft.Extensions.AI.McpServerToolCallContent, Microsoft.Extensions.AI.Abstractions");
    private static readonly Type? CodeInterpreterToolCallContentType = LoadType(
        "Microsoft.Extensions.AI.CodeInterpreterToolCallContent, Microsoft.Extensions.AI.Abstractions");
    private static readonly Type? ImageGenerationToolCallContentType = LoadType(
        "Microsoft.Extensions.AI.ImageGenerationToolCallContent, Microsoft.Extensions.AI.Abstractions");
    private readonly PatternValidator _patternValidator;

    public CopilotWorkflowRunner(PatternValidator patternValidator)
    {
        _patternValidator = patternValidator;
    }

    public async Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
        RunTurnCommandDto command,
        Func<TurnDeltaEventDto, Task> onDelta,
        Func<AgentActivityEventDto, Task> onActivity,
        CancellationToken cancellationToken)
    {
        PatternValidationIssueDto? validationError = _patternValidator.Validate(command.Pattern).FirstOrDefault();
        if (validationError is not null)
        {
            throw new InvalidOperationException(validationError.Message);
        }

        await using AgentBundle bundle = await AgentBundle.CreateAsync(command.Pattern, command.ProjectPath, cancellationToken);
        Workflow workflow = bundle.BuildWorkflow(command.Pattern);
        List<ChatMessage> inputMessages = command.Messages.Select(ToChatMessage).ToList();

        List<StreamingSegment> segments = [];
        int fallbackMessageIndex = 0;
        List<ChatMessageDto> completedMessages = [];
        AgentIdentity? activeAgent = null;
        HashSet<string> startedAgents = new(StringComparer.OrdinalIgnoreCase);

        await using StreamingRun run = await InProcessExecution.RunStreamingAsync(workflow, inputMessages).ConfigureAwait(false);
        await run.TrySendMessageAsync(new TurnToken(emitEvents: true)).ConfigureAwait(false);

        await foreach (WorkflowEvent evt in run.WatchStreamAsync(cancellationToken).ConfigureAwait(false))
        {
            if (evt is ExecutorInvokedEvent invoked
                && AgentIdentityResolver.TryResolveKnownAgentIdentity(
                    command.Pattern,
                    invoked.ExecutorId,
                    out AgentIdentity invokedAgent))
            {
                activeAgent = invokedAgent;
                await EmitThinkingIfNeeded(
                    command,
                    invokedAgent,
                    startedAgents,
                    onActivity).ConfigureAwait(false);
            }
            else if (evt is RequestInfoEvent requestInfo)
            {
                AgentActivityEventDto? activity = TryCreateActivityFromRequest(
                    command,
                    requestInfo,
                    activeAgent);

                if (activity is not null)
                {
                    if (string.Equals(activity.ActivityType, "handoff", StringComparison.Ordinal)
                        && !string.IsNullOrWhiteSpace(activity.AgentId)
                        && !string.IsNullOrWhiteSpace(activity.AgentName))
                    {
                        activeAgent = new AgentIdentity(activity.AgentId, activity.AgentName);
                    }

                    await onActivity(activity).ConfigureAwait(false);
                }
            }
            else if (evt is AgentResponseUpdateEvent update)
            {
                AgentIdentity? updateAgent = null;
                string authorName = update.ExecutorId;
                if (AgentIdentityResolver.TryResolveObservedAgentIdentity(
                    command.Pattern,
                    update.ExecutorId,
                    activeAgent,
                    out AgentIdentity resolvedUpdateAgent))
                {
                    updateAgent = resolvedUpdateAgent;
                    authorName = resolvedUpdateAgent.AgentName;
                }

                if (updateAgent.HasValue)
                {
                    activeAgent = updateAgent.Value;
                    await EmitThinkingIfNeeded(
                        command,
                        updateAgent.Value,
                        startedAgents,
                        onActivity).ConfigureAwait(false);
                }

                if (string.IsNullOrEmpty(update.Update.Text))
                {
                    continue;
                }

                string messageId = update.Update.MessageId ?? $"{command.RequestId}-delta-{fallbackMessageIndex++}";
                StreamingSegment segment = GetOrCreateSegment(segments, messageId, authorName);
                segment.Content.Append(update.Update.Text);

                await onDelta(new TurnDeltaEventDto
                {
                    Type = "turn-delta",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    MessageId = messageId,
                    AuthorName = authorName,
                    ContentDelta = update.Update.Text,
                }).ConfigureAwait(false);
            }
            else if (evt is ExecutorCompletedEvent completed
                && AgentIdentityResolver.TryResolveObservedAgentIdentity(
                    command.Pattern,
                    completed.ExecutorId,
                    activeAgent,
                    out AgentIdentity completedAgent))
            {
                if (activeAgent.HasValue
                    && string.Equals(activeAgent.Value.AgentId, completedAgent.AgentId, StringComparison.Ordinal))
                {
                    activeAgent = null;
                }
            }
            else if (evt is WorkflowOutputEvent outputEvent)
            {
                List<ChatMessage> allMessages = outputEvent.As<List<ChatMessage>>() ?? [];
                List<ChatMessage> newMessages = allMessages.Skip(inputMessages.Count).ToList();
                completedMessages = ProjectCompletedMessages(
                    command,
                    newMessages,
                    segments.Select(segment => (segment.MessageId, segment.AuthorName, segment.Content.ToString())).ToList(),
                    activeAgent);
            }
        }

        if (completedMessages.Count == 0 && segments.Count > 0)
        {
            completedMessages = ProjectCompletedMessages(
                command,
                [],
                segments.Select(segment => (segment.MessageId, segment.AuthorName, segment.Content.ToString())).ToList(),
                activeAgent);
        }

        return completedMessages;
    }

    private static AgentActivityEventDto CreateActivityEvent(
        RunTurnCommandDto command,
        string activityType,
        AgentIdentity agent,
        string? toolName = null)
    {
        return new AgentActivityEventDto
        {
            Type = "agent-activity",
            RequestId = command.RequestId,
            SessionId = command.SessionId,
            ActivityType = activityType,
            AgentId = agent.AgentId,
            AgentName = agent.AgentName,
            ToolName = toolName,
        };
    }

    private static AgentActivityEventDto? TryCreateActivityFromRequest(
        RunTurnCommandDto command,
        RequestInfoEvent requestInfo,
        AgentIdentity? activeAgent)
    {
        if (TryGetHandoffTarget(command.Pattern, requestInfo, out AgentIdentity handoffAgent))
        {
            return CreateActivityEvent(
                command,
                activityType: "handoff",
                agent: handoffAgent);
        }

        if (!activeAgent.HasValue || !TryGetToolName(requestInfo, out string toolName))
        {
            return null;
        }

        return CreateActivityEvent(
            command,
            activityType: "tool-calling",
            agent: activeAgent.Value,
            toolName: toolName);
    }

    private static async Task EmitThinkingIfNeeded(
        RunTurnCommandDto command,
        AgentIdentity agent,
        ISet<string> startedAgents,
        Func<AgentActivityEventDto, Task> onActivity)
    {
        if (!startedAgents.Add(agent.AgentId))
        {
            return;
        }

        await onActivity(CreateActivityEvent(
            command,
            activityType: "thinking",
            agent: agent)).ConfigureAwait(false);
    }

    private static bool TryGetHandoffTarget(
        PatternDefinitionDto pattern,
        RequestInfoEvent requestInfo,
        out AgentIdentity agent)
    {
        agent = default;
        if (!TryReadPortableValue(requestInfo.Request.Data, HandoffTargetType, out object? handoffTarget))
        {
            return false;
        }

        object? target = handoffTarget?.GetType().GetProperty("Target")?.GetValue(handoffTarget);
        agent = AgentIdentityResolver.ResolveAgentIdentity(
            pattern,
            GetStringProperty(target, "Id"),
            GetStringProperty(target, "Name"));
        return !string.IsNullOrWhiteSpace(agent.AgentName);
    }

    private static bool TryGetToolName(RequestInfoEvent requestInfo, out string toolName)
    {
        if (TryReadPortableValue(requestInfo.Request.Data, FunctionCallContentType, out object? functionCall))
        {
            toolName = GetStringProperty(functionCall, "Name") ?? "function";
            return true;
        }

        if (TryReadPortableValue(requestInfo.Request.Data, McpServerToolCallContentType, out object? mcpToolCall))
        {
            toolName = GetStringProperty(mcpToolCall, "ToolName")
                ?? GetStringProperty(mcpToolCall, "ServerName")
                ?? string.Empty;
            return !string.IsNullOrWhiteSpace(toolName);
        }

        if (TryReadPortableValue(requestInfo.Request.Data, CodeInterpreterToolCallContentType, out _))
        {
            toolName = "code interpreter";
            return true;
        }

        if (TryReadPortableValue(requestInfo.Request.Data, ImageGenerationToolCallContentType, out _))
        {
            toolName = "image generation";
            return true;
        }

        toolName = string.Empty;
        return false;
    }

    private static Type? LoadType(string assemblyQualifiedName)
    {
        return Type.GetType(assemblyQualifiedName, throwOnError: false);
    }

    private static bool TryReadPortableValue(PortableValue portableValue, Type? targetType, out object? value)
    {
        value = null;
        if (targetType is null || !portableValue.IsType(targetType))
        {
            return false;
        }

        value = portableValue.AsType(targetType);
        return value is not null;
    }

    private static string? GetStringProperty(object? instance, string propertyName)
    {
        return instance?.GetType().GetProperty(propertyName)?.GetValue(instance) as string;
    }

    private static StreamingSegment GetOrCreateSegment(List<StreamingSegment> segments, string messageId, string authorName)
    {
        StreamingSegment? existing = segments.LastOrDefault(segment => segment.MessageId == messageId);
        if (existing is not null)
        {
            return existing;
        }

        StreamingSegment created = new(messageId, authorName);
        segments.Add(created);
        return created;
    }

    internal static List<ChatMessageDto> ProjectCompletedMessages(
        RunTurnCommandDto command,
        IReadOnlyList<ChatMessage> newMessages,
        IReadOnlyList<(string MessageId, string AuthorName, string Content)> segments,
        AgentIdentity? fallbackAgent = null)
    {
        List<ChatMessageDto> mapped = [];
        int segmentIndex = 0;
        int fallbackOutputIndex = 0;

        foreach (ChatMessage message in newMessages.Where(message => message.Role != ChatRole.User))
        {
            (string MessageId, string AuthorName, string Content)? segment =
                segmentIndex < segments.Count ? segments[segmentIndex] : null;
            string content = message.Text ?? segment?.Content ?? string.Empty;
            if (string.IsNullOrWhiteSpace(content))
            {
                continue;
            }

            if (segment.HasValue)
            {
                segmentIndex++;
            }

            fallbackOutputIndex++;

            mapped.Add(new ChatMessageDto
            {
                Id = segment?.MessageId ?? $"{command.RequestId}-final-{fallbackOutputIndex}",
                Role = message.Role == ChatRole.System ? "system" : "assistant",
                AuthorName = ResolveProjectedAuthorName(
                    command.Pattern,
                    message.AuthorName,
                    segment?.AuthorName,
                    fallbackAgent),
                Content = content,
                CreatedAt = DateTimeOffset.UtcNow.ToString("O"),
            });
        }

        if (mapped.Count == 0 && segments.Count > 0)
        {
            mapped.AddRange(segments.Select(segment => new ChatMessageDto
            {
                Id = segment.MessageId,
                Role = "assistant",
                AuthorName = AgentIdentityResolver.ResolveDisplayAuthorName(command.Pattern, segment.AuthorName),
                Content = segment.Content,
                CreatedAt = DateTimeOffset.UtcNow.ToString("O"),
            }));
        }

        return mapped;
    }

    private static string ResolveProjectedAuthorName(
        PatternDefinitionDto pattern,
        string? primaryIdentifier,
        string? fallbackIdentifier,
        AgentIdentity? fallbackAgent)
    {
        if (fallbackAgent.HasValue && AgentIdentityResolver.IsGenericAssistantIdentifier(primaryIdentifier))
        {
            return fallbackAgent.Value.AgentName;
        }

        return AgentIdentityResolver.ResolveDisplayAuthorName(
            pattern,
            primaryIdentifier,
            fallbackIdentifier);
    }

    private static ChatMessage ToChatMessage(ChatMessageDto message)
    {
        ChatMessage mapped = new(message.Role switch
        {
            "user" => ChatRole.User,
            "system" => ChatRole.System,
            _ => ChatRole.Assistant,
        }, message.Content);

        if (!string.IsNullOrWhiteSpace(message.AuthorName))
        {
            mapped.AuthorName = message.AuthorName;
        }

        return mapped;
    }

    private sealed class StreamingSegment
    {
        public StreamingSegment(string messageId, string authorName)
        {
            MessageId = messageId;
            AuthorName = authorName;
        }

        public string MessageId { get; }

        public string AuthorName { get; }

        public StringBuilder Content { get; } = new();
    }

    private sealed class AgentBundle : IAsyncDisposable
    {
        private readonly List<IAsyncDisposable> _disposables = [];

        private AgentBundle(IReadOnlyList<AIAgent> agents)
        {
            Agents = agents;
        }

        public IReadOnlyList<AIAgent> Agents { get; }

        public static async Task<AgentBundle> CreateAsync(
            PatternDefinitionDto pattern,
            string projectPath,
            CancellationToken cancellationToken)
        {
            List<IAsyncDisposable> disposables = [];
            List<AIAgent> agents = [];
            CopilotClientOptions clientOptions = CopilotCliPathResolver.CreateClientOptions();

            foreach (PatternAgentDefinitionDto definition in pattern.Agents)
            {
                CopilotClient client = new(clientOptions);
                await client.StartAsync(cancellationToken).ConfigureAwait(false);

                SessionConfig sessionConfig = new()
                {
                    Model = definition.Model,
                    ReasoningEffort = definition.ReasoningEffort,
                    SystemMessage = new SystemMessageConfig
                    {
                        Content = definition.Instructions,
                    },
                    WorkingDirectory = projectPath,
                    OnPermissionRequest = ApprovePermissionAsync,
                    Streaming = true,
                };

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

            AgentBundle bundle = new(agents);
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
            IReadOnlyList<AIAgent> specialists = Agents.Skip(1).ToList();

            HandoffsWorkflowBuilder builder = AgentWorkflowBuilder.CreateHandoffBuilderWith(firstAgent)
                .WithHandoffs(firstAgent, specialists)
                .WithHandoffs(specialists, firstAgent);

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

        private static Task<PermissionRequestResult> ApprovePermissionAsync(
            PermissionRequest request,
            PermissionInvocation invocation)
        {
            return Task.FromResult(new PermissionRequestResult
            {
                Kind = PermissionRequestResultKind.Approved,
            });
        }
    }
}
