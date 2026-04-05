using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;

namespace Aryx.AgentHost.Tests;

public sealed class WorkflowConditionEvaluatorTests
{
    [Fact]
    public void Evaluate_PropertyCondition_MatchesPayload()
    {
        EdgeConditionDto condition = new()
        {
            Type = "property",
            Combinator = "and",
            Rules =
            [
                new WorkflowConditionRuleDto
                {
                    PropertyPath = "Role",
                    Operator = "equals",
                    Value = "user",
                },
            ],
        };

        bool matched = WorkflowConditionEvaluator.Evaluate(condition, new TestPayload("user", 1, "hello"));

        Assert.True(matched);
    }

    [Fact]
    public void Evaluate_ExpressionCondition_MatchesPayload()
    {
        EdgeConditionDto condition = new()
        {
            Type = "expression",
            Expression = "Iteration < 3 && Role == \"user\"",
        };

        bool matched = WorkflowConditionEvaluator.Evaluate(condition, new TestPayload("user", 2, "hello"));

        Assert.True(matched);
    }

    [Fact]
    public void Compile_LoopCondition_StopsAfterMaxIterations()
    {
        WorkflowEdgeDto edge = new()
        {
            Id = "edge-loop",
            Source = "agent",
            Target = "agent",
            Kind = "direct",
            IsLoop = true,
            MaxIterations = 2,
            Condition = new EdgeConditionDto
            {
                Type = "property",
                Rules =
                [
                    new WorkflowConditionRuleDto
                    {
                        PropertyPath = "Iteration",
                        Operator = "lt",
                        Value = "10",
                    },
                ],
            },
        };

        Func<object?, bool>? compiled = WorkflowConditionEvaluator.Compile(edge);

        Assert.NotNull(compiled);
        Assert.True(compiled!(new TestPayload("user", 1, "hello")));
        Assert.True(compiled(new TestPayload("user", 2, "hello")));
        Assert.False(compiled(new TestPayload("user", 3, "hello")));
    }

    private sealed record TestPayload(string Role, int Iteration, string Content);
}
