using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class WorkflowOutputMessagesExecutor(ChatProtocolExecutorOptions? options = null)
    : ChatProtocolExecutor(ExecutorId, options, declareCrossRunShareable: true), IResettableExecutor
{
    public const string ExecutorId = "OutputMessages";

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
        => base.ConfigureProtocol(protocolBuilder)
            .YieldsOutput<List<ChatMessage>>();

    protected override ValueTask TakeTurnAsync(
        List<ChatMessage> messages,
        IWorkflowContext context,
        bool? emitEvents,
        CancellationToken cancellationToken = default)
        => context.YieldOutputAsync(messages, cancellationToken);

    ValueTask IResettableExecutor.ResetAsync() => default;
}

internal sealed class WorkflowAggregateTurnMessagesExecutor(string id)
    : ChatProtocolExecutor(id, s_options, declareCrossRunShareable: true), IResettableExecutor
{
    private static readonly ChatProtocolExecutorOptions s_options = new() { AutoSendTurnToken = false };

    protected override ValueTask TakeTurnAsync(
        List<ChatMessage> messages,
        IWorkflowContext context,
        bool? emitEvents,
        CancellationToken cancellationToken = default)
        => context.SendMessageAsync(messages, cancellationToken: cancellationToken);

    ValueTask IResettableExecutor.ResetAsync() => this.ResetAsync();
}

internal sealed class WorkflowConcurrentEndExecutor : Executor, IResettableExecutor
{
    public const string ExecutorId = "ConcurrentEnd";

    private readonly int _expectedInputs;
    private readonly Func<IList<List<ChatMessage>>, List<ChatMessage>> _aggregator;
    private List<List<ChatMessage>> _allResults;
    private int _remaining;

    public WorkflowConcurrentEndExecutor(
        int expectedInputs,
        Func<IList<List<ChatMessage>>, List<ChatMessage>> aggregator)
        : base(ExecutorId)
    {
        _expectedInputs = expectedInputs;
        _aggregator = aggregator;
        _allResults = new List<List<ChatMessage>>(expectedInputs);
        _remaining = expectedInputs;
    }

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
    {
        protocolBuilder.RouteBuilder.AddHandler<List<ChatMessage>>(async (messages, context, cancellationToken) =>
        {
            bool done;
            lock (_allResults)
            {
                _allResults.Add(messages);
                done = --_remaining == 0;
            }

            if (!done)
            {
                return;
            }

            _remaining = _expectedInputs;
            List<List<ChatMessage>> results = _allResults;
            _allResults = new List<List<ChatMessage>>(_expectedInputs);
            await context.YieldOutputAsync(_aggregator(results), cancellationToken).ConfigureAwait(false);
        });

        return protocolBuilder.YieldsOutput<List<ChatMessage>>();
    }

    public ValueTask ResetAsync()
    {
        _allResults = new List<List<ChatMessage>>(_expectedInputs);
        _remaining = _expectedInputs;
        return default;
    }
}

internal sealed class WorkflowRoundRobinGroupChatHost(
    string id,
    AIAgent[] agents,
    Dictionary<AIAgent, ExecutorBinding> agentMap,
    int maximumIterations)
    : ChatProtocolExecutor(id, s_options), IResettableExecutor
{
    private static readonly ChatProtocolExecutorOptions s_options = new()
    {
        StringMessageChatRole = ChatRole.User,
        AutoSendTurnToken = false,
    };

    private readonly AIAgent[] _agents = agents;
    private readonly Dictionary<AIAgent, ExecutorBinding> _agentMap = agentMap;
    private readonly int _maximumIterations = maximumIterations;
    private int _iterationCount;
    private int _nextIndex;

    protected override ProtocolBuilder ConfigureProtocol(ProtocolBuilder protocolBuilder)
        => base.ConfigureProtocol(protocolBuilder).YieldsOutput<List<ChatMessage>>();

    protected override async ValueTask TakeTurnAsync(
        List<ChatMessage> messages,
        IWorkflowContext context,
        bool? emitEvents,
        CancellationToken cancellationToken = default)
    {
        if (_iterationCount < _maximumIterations)
        {
            AIAgent nextAgent = _agents[_nextIndex];
            _nextIndex = (_nextIndex + 1) % _agents.Length;

            if (_agentMap.TryGetValue(nextAgent, out ExecutorBinding? executor))
            {
                _iterationCount++;
                await context.SendMessageAsync(messages, executor.Id, cancellationToken).ConfigureAwait(false);
                await context.SendMessageAsync(new TurnToken(emitEvents), executor.Id, cancellationToken).ConfigureAwait(false);
                return;
            }
        }

        _iterationCount = 0;
        _nextIndex = 0;
        await context.YieldOutputAsync(messages, cancellationToken).ConfigureAwait(false);
    }

    protected override ValueTask ResetAsync()
    {
        _iterationCount = 0;
        _nextIndex = 0;
        return base.ResetAsync();
    }

    ValueTask IResettableExecutor.ResetAsync() => this.ResetAsync();
}
