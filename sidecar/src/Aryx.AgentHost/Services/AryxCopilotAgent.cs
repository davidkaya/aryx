using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class AryxCopilotAgent : AIAgent, IAsyncDisposable
{
    private const string DefaultName = "GitHub Copilot Agent";
    private const string DefaultDescription = "An AI agent powered by GitHub Copilot";
    private const string HandoffToolPrefix = "handoff_to_";
    private static readonly JsonSerializerOptions ToolArgumentJsonOptions = JsonSerialization.CreateWebOptions();
    private readonly CopilotClient _copilotClient;
    private readonly string? _id;
    private readonly string _name;
    private readonly string _description;
    private readonly SessionConfig? _sessionConfig;
    private readonly bool _ownsClient;

    public AryxCopilotAgent(
        CopilotClient copilotClient,
        SessionConfig? sessionConfig = null,
        bool ownsClient = false,
        string? id = null,
        string? name = null,
        string? description = null)
    {
        _copilotClient = copilotClient ?? throw new ArgumentNullException(nameof(copilotClient));
        _sessionConfig = sessionConfig;
        _ownsClient = ownsClient;
        _id = id;
        _name = name ?? DefaultName;
        _description = description ?? DefaultDescription;
    }

    protected override ValueTask<AgentSession> CreateSessionCoreAsync(CancellationToken cancellationToken = default)
        => new(new AryxCopilotAgentSession());

    protected override ValueTask<JsonElement> SerializeSessionCoreAsync(
        AgentSession session,
        JsonSerializerOptions? jsonSerializerOptions = null,
        CancellationToken cancellationToken = default)
    {
        if (session is not AryxCopilotAgentSession typedSession)
        {
            throw new InvalidOperationException(
                $"The provided session type '{session.GetType().Name}' is not compatible with this agent. Only sessions of type '{nameof(AryxCopilotAgentSession)}' can be serialized by this agent.");
        }

        return new(typedSession.Serialize(jsonSerializerOptions));
    }

    protected override ValueTask<AgentSession> DeserializeSessionCoreAsync(
        JsonElement serializedState,
        JsonSerializerOptions? jsonSerializerOptions = null,
        CancellationToken cancellationToken = default)
        => new(AryxCopilotAgentSession.Deserialize(serializedState, jsonSerializerOptions));

    protected override Task<AgentResponse> RunCoreAsync(
        IEnumerable<ChatMessage> messages,
        AgentSession? session = null,
        AgentRunOptions? options = null,
        CancellationToken cancellationToken = default)
        => RunCoreStreamingAsync(messages, session, options, cancellationToken).ToAgentResponseAsync(cancellationToken);

    protected override async IAsyncEnumerable<AgentResponseUpdate> RunCoreStreamingAsync(
        IEnumerable<ChatMessage> messages,
        AgentSession? session = null,
        AgentRunOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(messages);

        session ??= await CreateSessionAsync(cancellationToken).ConfigureAwait(false);
        if (session is not AryxCopilotAgentSession typedSession)
        {
            throw new InvalidOperationException(
                $"The provided session type '{session.GetType().Name}' is not compatible with this agent. Only sessions of type '{nameof(AryxCopilotAgentSession)}' can be used by this agent.");
        }

        await EnsureClientStartedAsync(cancellationToken).ConfigureAwait(false);

        SessionConfig sessionConfig = CreateConfiguredSessionConfig(_sessionConfig, options);
        CopilotSession copilotSession;
        if (typedSession.SessionId is not null)
        {
            copilotSession = await _copilotClient.ResumeSessionAsync(
                typedSession.SessionId,
                CreateResumeConfig(sessionConfig),
                cancellationToken).ConfigureAwait(false);
        }
        else
        {
            copilotSession = await _copilotClient.CreateSessionAsync(sessionConfig, cancellationToken).ConfigureAwait(false);
            typedSession.SessionId = copilotSession.SessionId;
        }

        try
        {
            Channel<AgentResponseUpdate> channel = Channel.CreateUnbounded<AgentResponseUpdate>();

            using IDisposable subscription = copilotSession.On(evt =>
            {
                switch (evt)
                {
                    case AssistantMessageDeltaEvent deltaEvent:
                        channel.Writer.TryWrite(ConvertToAgentResponseUpdate(deltaEvent));
                        break;

                    case AssistantMessageEvent assistantMessage:
                        channel.Writer.TryWrite(ConvertToAgentResponseUpdate(assistantMessage));
                        break;

                    case AssistantUsageEvent usageEvent:
                        channel.Writer.TryWrite(ConvertToAgentResponseUpdate(usageEvent));
                        break;

                    case SessionIdleEvent idleEvent:
                        channel.Writer.TryWrite(ConvertToAgentResponseUpdate(idleEvent));
                        channel.Writer.TryComplete();
                        break;

                    case SessionErrorEvent errorEvent:
                        channel.Writer.TryWrite(ConvertToAgentResponseUpdate(errorEvent));
                        channel.Writer.TryComplete(new InvalidOperationException(
                            $"Session error: {errorEvent.Data?.Message ?? "Unknown error"}"));
                        break;

                    default:
                        channel.Writer.TryWrite(ConvertToAgentResponseUpdate(evt));
                        break;
                }
            });

            string? tempDir = null;
            try
            {
                string prompt = string.Join("\n", messages.Select(message => message.Text));
                (List<UserMessageDataAttachmentsItem>? attachments, string? messageMode, tempDir) = await ProcessMessageAttachmentsAsync(
                    messages,
                    cancellationToken).ConfigureAwait(false);

                MessageOptions messageOptions = new()
                {
                    Prompt = prompt,
                    Mode = string.IsNullOrWhiteSpace(messageMode) ? null : messageMode,
                };

                if (attachments is not null)
                {
                    messageOptions.Attachments = [.. attachments];
                }

                await copilotSession.SendAsync(messageOptions, cancellationToken).ConfigureAwait(false);
                await foreach (AgentResponseUpdate update in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
                {
                    yield return update;
                }
            }
            finally
            {
                CleanupTempDir(tempDir);
            }
        }
        finally
        {
            await copilotSession.DisposeAsync().ConfigureAwait(false);
        }
    }

    protected override string? IdCore => _id;

    public override string Name => _name;

    public override string Description => _description;

    public async ValueTask DisposeAsync()
    {
        if (_ownsClient)
        {
            await _copilotClient.DisposeAsync().ConfigureAwait(false);
        }
    }

    internal static SessionConfig CreateConfiguredSessionConfig(SessionConfig? source, AgentRunOptions? options)
    {
        SessionConfig sessionConfig = source?.Clone() ?? new SessionConfig();
        sessionConfig.Streaming = true;
        if (sessionConfig.SystemMessage is not null)
        {
            sessionConfig.SystemMessage = CloneSystemMessage(sessionConfig.SystemMessage);
        }

        if (options is not ChatClientAgentRunOptions { ChatOptions: { } chatOptions })
        {
            return sessionConfig;
        }

        if (!string.IsNullOrWhiteSpace(chatOptions.ModelId))
        {
            sessionConfig.Model = chatOptions.ModelId;
        }

        if (!string.IsNullOrWhiteSpace(chatOptions.Instructions))
        {
            AppendInstructions(sessionConfig, chatOptions.Instructions);
        }

        sessionConfig.Tools = MergeTools(sessionConfig.Tools, chatOptions.Tools);
        return sessionConfig;
    }

    internal static IReadOnlyList<FunctionCallContent> ConvertToolRequestsToFunctionCalls(
        AssistantMessageDataToolRequestsItem[]? toolRequests)
    {
        if (toolRequests is not { Length: > 0 })
        {
            return [];
        }

        List<FunctionCallContent> contents = [];
        foreach (AssistantMessageDataToolRequestsItem toolRequest in toolRequests)
        {
            if (string.IsNullOrWhiteSpace(toolRequest.ToolCallId) || string.IsNullOrWhiteSpace(toolRequest.Name))
            {
                continue;
            }

            // Only project handoff tool calls as FunctionCallContent for the Agent Framework.
            // Other tool calls (ask_user, MCP tools, etc.) are resolved by the Copilot SDK
            // internally and must not be surfaced, because AIAgentHostExecutor tracks every
            // FunctionCallContent as an outstanding request.  An unmatched request prevents
            // the executor from emitting a TurnToken, which stalls group-chat advancement.
            if (!IsHandoffToolName(toolRequest.Name))
            {
                continue;
            }

            contents.Add(new FunctionCallContent(
                toolRequest.ToolCallId,
                toolRequest.Name,
                ParseToolArguments(toolRequest.Arguments)));
        }

        return contents;
    }

    private static bool IsHandoffToolName(string? name)
    {
        return !string.IsNullOrWhiteSpace(name)
            && name.StartsWith(HandoffToolPrefix, StringComparison.Ordinal);
    }

    private async Task EnsureClientStartedAsync(CancellationToken cancellationToken)
    {
        if (_copilotClient.State != ConnectionState.Connected)
        {
            await _copilotClient.StartAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private static ResumeSessionConfig CreateResumeConfig(SessionConfig source)
    {
        return new ResumeSessionConfig
        {
            ClientName = source.ClientName,
            Model = source.Model,
            Tools = source.Tools is not null ? [.. source.Tools] : null,
            SystemMessage = CloneSystemMessage(source.SystemMessage),
            AvailableTools = source.AvailableTools is not null ? [.. source.AvailableTools] : null,
            ExcludedTools = source.ExcludedTools is not null ? [.. source.ExcludedTools] : null,
            Provider = source.Provider,
            OnPermissionRequest = source.OnPermissionRequest,
            OnUserInputRequest = source.OnUserInputRequest,
            Hooks = source.Hooks,
            WorkingDirectory = source.WorkingDirectory,
            ConfigDir = source.ConfigDir,
            Streaming = true,
            McpServers = source.McpServers is not null
                ? new Dictionary<string, object>(source.McpServers, source.McpServers.Comparer)
                : null,
            CustomAgents = source.CustomAgents is not null ? [.. source.CustomAgents] : null,
            Agent = source.Agent,
            SkillDirectories = source.SkillDirectories is not null ? [.. source.SkillDirectories] : null,
            DisabledSkills = source.DisabledSkills is not null ? [.. source.DisabledSkills] : null,
            InfiniteSessions = source.InfiniteSessions,
            OnEvent = source.OnEvent,
            ReasoningEffort = source.ReasoningEffort,
        };
    }

    private static SystemMessageConfig? CloneSystemMessage(SystemMessageConfig? source)
    {
        if (source is null)
        {
            return null;
        }

        return new SystemMessageConfig
        {
            Mode = source.Mode,
            Content = source.Content,
            Sections = source.Sections is not null ? new Dictionary<string, SectionOverride>(source.Sections) : null,
        };
    }

    private static void AppendInstructions(SessionConfig sessionConfig, string instructions)
    {
        string trimmedInstructions = instructions.Trim();
        if (trimmedInstructions.Length == 0)
        {
            return;
        }

        if (sessionConfig.SystemMessage is null)
        {
            sessionConfig.SystemMessage = new SystemMessageConfig
            {
                Mode = SystemMessageMode.Append,
                Content = trimmedInstructions,
            };
            return;
        }

        string? existingContent = sessionConfig.SystemMessage.Content;
        sessionConfig.SystemMessage.Content = string.IsNullOrWhiteSpace(existingContent)
            ? trimmedInstructions
            : $"{existingContent.Trim()}\n\n{trimmedInstructions}";
    }

    private static ICollection<AIFunction>? MergeTools(
        ICollection<AIFunction>? sessionTools,
        IList<AITool>? runtimeTools)
    {
        if (runtimeTools is not { Count: > 0 })
        {
            return sessionTools;
        }

        List<AIFunction> mergedTools = sessionTools is not null ? [.. sessionTools] : [];
        foreach (AITool runtimeTool in runtimeTools)
        {
            mergedTools.Add(MapRuntimeTool(runtimeTool));
        }

        return mergedTools;
    }

    private static AIFunction MapRuntimeTool(AITool tool)
    {
        return tool switch
        {
            AIFunction function => function,
            AIFunctionDeclaration declaration when IsHandoffDeclaration(declaration) => CreateInvokableHandoffFunction(declaration),
            AIFunctionDeclaration declaration => throw new NotSupportedException(
                $"GitHub Copilot session tools must be invokable AIFunctions. Runtime tool '{declaration.Name}' is declaration-only."),
            _ => throw new NotSupportedException(
                $"GitHub Copilot session tools must be invokable AIFunctions. Runtime tool '{tool.Name}' is not supported."),
        };
    }

    private static bool IsHandoffDeclaration(AIFunctionDeclaration declaration)
    {
        return IsHandoffToolName(declaration.Name);
    }

    private static AIFunction CreateInvokableHandoffFunction(AIFunctionDeclaration declaration)
    {
        AIFunction function = AIFunctionFactory.Create(
            (string? reasonForHandoff) => "Transferred.",
            new AIFunctionFactoryOptions
            {
                Name = declaration.Name,
                Description = declaration.Description,
                AdditionalProperties = new Dictionary<string, object?>
                {
                    ["skip_permission"] = true,
                },
            });
        return function;
    }

    private AgentResponseUpdate ConvertToAgentResponseUpdate(AssistantMessageDeltaEvent deltaEvent)
    {
        TextContent textContent = new(deltaEvent.Data?.DeltaContent ?? string.Empty)
        {
            RawRepresentation = deltaEvent,
        };

        return new AgentResponseUpdate(ChatRole.Assistant, [textContent])
        {
            AgentId = Id,
            MessageId = deltaEvent.Data?.MessageId,
            CreatedAt = deltaEvent.Timestamp,
        };
    }

    private AgentResponseUpdate ConvertToAgentResponseUpdate(AssistantMessageEvent assistantMessage)
    {
        List<AIContent> contents = [];
        contents.AddRange(ConvertToolRequestsToFunctionCalls(assistantMessage.Data?.ToolRequests));
        contents.Add(new AIContent
        {
            RawRepresentation = assistantMessage,
        });

        return new AgentResponseUpdate(ChatRole.Assistant, contents)
        {
            AgentId = Id,
            ResponseId = assistantMessage.Data?.MessageId,
            MessageId = assistantMessage.Data?.MessageId,
            CreatedAt = assistantMessage.Timestamp,
        };
    }

    private AgentResponseUpdate ConvertToAgentResponseUpdate(AssistantUsageEvent usageEvent)
    {
        UsageDetails usageDetails = new()
        {
            InputTokenCount = (int?)usageEvent.Data?.InputTokens,
            OutputTokenCount = (int?)usageEvent.Data?.OutputTokens,
            TotalTokenCount = (int?)((usageEvent.Data?.InputTokens ?? 0) + (usageEvent.Data?.OutputTokens ?? 0)),
            CachedInputTokenCount = (int?)usageEvent.Data?.CacheReadTokens,
        };

        UsageContent usageContent = new(usageDetails)
        {
            RawRepresentation = usageEvent,
        };

        return new AgentResponseUpdate(ChatRole.Assistant, [usageContent])
        {
            AgentId = Id,
            CreatedAt = usageEvent.Timestamp,
        };
    }

    private AgentResponseUpdate ConvertToAgentResponseUpdate(SessionEvent sessionEvent)
    {
        AIContent content = new()
        {
            RawRepresentation = sessionEvent,
        };

        return new AgentResponseUpdate(ChatRole.Assistant, [content])
        {
            AgentId = Id,
            CreatedAt = sessionEvent.Timestamp,
        };
    }

    private static Dictionary<string, object?>? ParseToolArguments(object? arguments)
    {
        if (arguments is null)
        {
            return null;
        }

        if (arguments is Dictionary<string, object?> dictionary)
        {
            return new Dictionary<string, object?>(dictionary, StringComparer.Ordinal);
        }

        if (arguments is JsonElement jsonElement)
        {
            if (jsonElement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                return null;
            }

            return JsonSerializer.Deserialize<Dictionary<string, object?>>(jsonElement.GetRawText(), ToolArgumentJsonOptions);
        }

        string json = JsonSerializer.Serialize(arguments, arguments.GetType(), ToolArgumentJsonOptions);
        return JsonSerializer.Deserialize<Dictionary<string, object?>>(json, ToolArgumentJsonOptions);
    }

    internal static async Task<(List<UserMessageDataAttachmentsItem>? Attachments, string? MessageMode, string? TempDir)> ProcessMessageAttachmentsAsync(
        IEnumerable<ChatMessage> messages,
        CancellationToken cancellationToken)
    {
        List<UserMessageDataAttachmentsItem>? attachments = null;
        string? messageMode = null;
        string? tempDir = null;
        foreach (ChatMessage message in messages)
        {
            foreach (AIContent content in message.Contents)
            {
                if (content is DataContent dataContent)
                {
                    tempDir ??= Directory.CreateDirectory(
                        Path.Combine(Path.GetTempPath(), $"af_copilot_{Guid.NewGuid():N}")).FullName;

                    string tempFilePath = await dataContent.SaveToAsync(tempDir, cancellationToken).ConfigureAwait(false);

                    attachments ??= [];
                    attachments.Add(new UserMessageDataAttachmentsItemFile
                    {
                        Path = tempFilePath,
                        DisplayName = Path.GetFileName(tempFilePath),
                    });
                    continue;
                }

                if (content.RawRepresentation is ChatMessageAttachmentDto protocolAttachment)
                {
                    attachments ??= [];
                    attachments.Add(CreateProtocolAttachment(protocolAttachment));
                    continue;
                }

                if (content.RawRepresentation is CopilotMessageOptionsMetadata metadata
                    && !string.IsNullOrWhiteSpace(metadata.MessageMode))
                {
                    messageMode = metadata.MessageMode.Trim();
                }
            }
        }

        return (attachments, messageMode, tempDir);
    }

    private static UserMessageDataAttachmentsItem CreateProtocolAttachment(ChatMessageAttachmentDto attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);

        return attachment.Type switch
        {
            "file" => CreateFileAttachment(attachment),
            "blob" => CreateBlobAttachment(attachment),
            _ => throw new NotSupportedException($"Unsupported attachment type '{attachment.Type}'."),
        };
    }

    private static UserMessageDataAttachmentsItemFile CreateFileAttachment(ChatMessageAttachmentDto attachment)
    {
        if (string.IsNullOrWhiteSpace(attachment.Path))
        {
            throw new InvalidOperationException("File attachments require an absolute path.");
        }

        string path = attachment.Path.Trim();
        if (!Path.IsPathRooted(path))
        {
            throw new InvalidOperationException($"File attachment path '{path}' must be absolute.");
        }

        return new UserMessageDataAttachmentsItemFile
        {
            Path = path,
            DisplayName = string.IsNullOrWhiteSpace(attachment.DisplayName)
                ? Path.GetFileName(path)
                : attachment.DisplayName.Trim(),
        };
    }

    private static UserMessageDataAttachmentsItemBlob CreateBlobAttachment(ChatMessageAttachmentDto attachment)
    {
        if (string.IsNullOrWhiteSpace(attachment.Data))
        {
            throw new InvalidOperationException("Blob attachments require base64-encoded data.");
        }

        if (string.IsNullOrWhiteSpace(attachment.MimeType))
        {
            throw new InvalidOperationException("Blob attachments require a MIME type.");
        }

        return new UserMessageDataAttachmentsItemBlob
        {
            Data = attachment.Data.Trim(),
            MimeType = attachment.MimeType.Trim(),
            DisplayName = string.IsNullOrWhiteSpace(attachment.DisplayName) ? null : attachment.DisplayName.Trim(),
        };
    }

    private static void CleanupTempDir(string? tempDir)
    {
        if (tempDir is null)
        {
            return;
        }

        try
        {
            Directory.Delete(tempDir, recursive: true);
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }
}

internal sealed class AryxCopilotAgentSession : AgentSession
{
    private static readonly JsonSerializerOptions DefaultJsonOptions = JsonSerialization.CreateWebOptions();

    public AryxCopilotAgentSession()
    {
    }

    [JsonConstructor]
    public AryxCopilotAgentSession(string? sessionId, AgentSessionStateBag? stateBag = null)
        : base(stateBag ?? new AgentSessionStateBag())
    {
        SessionId = sessionId;
    }

    [JsonPropertyName("sessionId")]
    public string? SessionId { get; set; }

    internal JsonElement Serialize(JsonSerializerOptions? jsonSerializerOptions = null)
    {
        JsonSerializerOptions options = jsonSerializerOptions ?? DefaultJsonOptions;
        return JsonSerializer.SerializeToElement(this, options);
    }

    internal static AryxCopilotAgentSession Deserialize(
        JsonElement serializedState,
        JsonSerializerOptions? jsonSerializerOptions = null)
    {
        if (serializedState.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("The serialized session state must be a JSON object.", nameof(serializedState));
        }

        JsonSerializerOptions options = jsonSerializerOptions ?? DefaultJsonOptions;
        return serializedState.Deserialize<AryxCopilotAgentSession>(options)
            ?? new AryxCopilotAgentSession();
    }
}
