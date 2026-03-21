using System.Text;
using GitHub.Copilot.SDK;
using Kopaya.AgentHost.Contracts;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.GitHub.Copilot;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Agents.AI.Workflows.Specialized;
using Microsoft.Extensions.AI;

namespace Kopaya.AgentHost.Services;

public sealed class CopilotWorkflowRunner
{
    private readonly PatternValidator _patternValidator;

    public CopilotWorkflowRunner(PatternValidator patternValidator)
    {
        _patternValidator = patternValidator;
    }

    public async Task<IReadOnlyList<ChatMessageDto>> RunTurnAsync(
        RunTurnCommandDto command,
        Func<TurnDeltaEventDto, Task> onDelta,
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

        await using StreamingRun run = await InProcessExecution.RunStreamingAsync(workflow, inputMessages).ConfigureAwait(false);
        await run.TrySendMessageAsync(new TurnToken(emitEvents: true)).ConfigureAwait(false);

        await foreach (WorkflowEvent evt in run.WatchStreamAsync(cancellationToken).ConfigureAwait(false))
        {
            if (evt is AgentResponseUpdateEvent update && !string.IsNullOrEmpty(update.Update.Text))
            {
                string messageId = update.Update.MessageId ?? $"{command.RequestId}-delta-{fallbackMessageIndex++}";
                StreamingSegment segment = GetOrCreateSegment(segments, messageId, update.ExecutorId);
                segment.Content.Append(update.Update.Text);

                await onDelta(new TurnDeltaEventDto
                {
                    Type = "turn-delta",
                    RequestId = command.RequestId,
                    SessionId = command.SessionId,
                    MessageId = messageId,
                    AuthorName = update.ExecutorId,
                    ContentDelta = update.Update.Text,
                }).ConfigureAwait(false);
            }
            else if (evt is WorkflowOutputEvent outputEvent)
            {
                List<ChatMessage> allMessages = outputEvent.As<List<ChatMessage>>() ?? [];
                List<ChatMessage> newMessages = allMessages.Skip(inputMessages.Count).ToList();
                completedMessages = ConvertOutputMessages(command, newMessages, segments);
            }
        }

        return completedMessages;
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

    private static List<ChatMessageDto> ConvertOutputMessages(
        RunTurnCommandDto command,
        IReadOnlyList<ChatMessage> newMessages,
        IReadOnlyList<StreamingSegment> segments)
    {
        List<ChatMessageDto> mapped = [];
        int segmentIndex = 0;

        foreach (ChatMessage message in newMessages.Where(message => message.Role != ChatRole.User))
        {
            StreamingSegment? segment = segmentIndex < segments.Count ? segments[segmentIndex] : null;
            segmentIndex++;

            mapped.Add(new ChatMessageDto
            {
                Id = segment?.MessageId ?? $"{command.RequestId}-final-{segmentIndex}",
                Role = message.Role == ChatRole.System ? "system" : "assistant",
                AuthorName = message.AuthorName ?? segment?.AuthorName ?? "assistant",
                Content = message.Text ?? segment?.Content.ToString() ?? string.Empty,
                CreatedAt = DateTimeOffset.UtcNow.ToString("O"),
            });
        }

        if (mapped.Count == 0 && segments.Count > 0)
        {
            mapped.AddRange(segments.Select(segment => new ChatMessageDto
            {
                Id = segment.MessageId,
                Role = "assistant",
                AuthorName = segment.AuthorName,
                Content = segment.Content.ToString(),
                CreatedAt = DateTimeOffset.UtcNow.ToString("O"),
            }));
        }

        return mapped;
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
