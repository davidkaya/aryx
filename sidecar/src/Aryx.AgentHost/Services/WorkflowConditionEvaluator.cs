using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal static class WorkflowConditionEvaluator
{
    private static readonly HashSet<string> SupportedConditionTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "always",
        "message-type",
        "expression",
        "property",
    };

    private static readonly HashSet<string> SupportedOperators = new(StringComparer.OrdinalIgnoreCase)
    {
        "equals",
        "not-equals",
        "contains",
        "gt",
        "lt",
        "regex",
    };

    private static readonly Regex ComparisonExpression = new(
        @"^(?<path>[A-Za-z_][A-Za-z0-9_\.]*)\s*(?<operator>==|!=|>|<|contains|matches)\s*(?<value>""(?:[^""\\]|\\.)*""|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    internal static bool IsSupportedConditionType(string? type)
        => !string.IsNullOrWhiteSpace(type) && SupportedConditionTypes.Contains(type);

    internal static bool IsSupportedOperator(string? @operator)
        => !string.IsNullOrWhiteSpace(@operator) && SupportedOperators.Contains(@operator);

    internal static bool IsSupportedExpression(string? expression)
    {
        if (string.IsNullOrWhiteSpace(expression))
        {
            return false;
        }

        string trimmed = expression.Trim();
        if (string.Equals(trimmed, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(trimmed, "false", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        string? delimiter = trimmed.Contains("&&", StringComparison.Ordinal) ? "&&" : null;
        if (delimiter is null && trimmed.Contains("||", StringComparison.Ordinal))
        {
            delimiter = "||";
        }

        if (delimiter is null)
        {
            return ComparisonExpression.IsMatch(trimmed);
        }

        return trimmed
            .Split(delimiter, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .All(segment => ComparisonExpression.IsMatch(segment));
    }

    internal static Func<object?, bool>? Compile(WorkflowEdgeDto edge)
    {
        ArgumentNullException.ThrowIfNull(edge);

        Func<object?, bool>? baseCondition = edge.Condition is null
            ? null
            : CompileCondition(edge.Condition);

        if (edge.IsLoop != true)
        {
            return baseCondition;
        }

        int maxIterations = edge.MaxIterations ?? 0;
        int successfulIterations = 0;
        return payload =>
        {
            if (successfulIterations >= maxIterations)
            {
                return false;
            }

            if (baseCondition is not null && !baseCondition(payload))
            {
                return false;
            }

            successfulIterations++;
            return true;
        };
    }

    internal static bool Evaluate(EdgeConditionDto condition, object? payload)
    {
        ArgumentNullException.ThrowIfNull(condition);
        return CompileCondition(condition)?.Invoke(payload) ?? true;
    }

    private static Func<object?, bool>? CompileCondition(EdgeConditionDto condition)
    {
        if (string.IsNullOrWhiteSpace(condition.Type)
            || string.Equals(condition.Type, "always", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (string.Equals(condition.Type, "message-type", StringComparison.OrdinalIgnoreCase))
        {
            string expectedTypeName = condition.TypeName?.Trim() ?? string.Empty;
            return payload =>
            {
                if (payload is null || string.IsNullOrWhiteSpace(expectedTypeName))
                {
                    return false;
                }

                Type payloadType = payload.GetType();
                return string.Equals(payloadType.Name, expectedTypeName, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(payloadType.FullName, expectedTypeName, StringComparison.OrdinalIgnoreCase);
            };
        }

        if (string.Equals(condition.Type, "property", StringComparison.OrdinalIgnoreCase))
        {
            string combinator = string.Equals(condition.Combinator, "or", StringComparison.OrdinalIgnoreCase) ? "or" : "and";
            return payload =>
            {
                IReadOnlyList<bool> results = condition.Rules
                    .Select(rule => EvaluateRule(rule, payload))
                    .ToArray();

                if (results.Count == 0)
                {
                    return false;
                }

                return string.Equals(combinator, "or", StringComparison.OrdinalIgnoreCase)
                    ? results.Any(result => result)
                    : results.All(result => result);
            };
        }

        if (string.Equals(condition.Type, "expression", StringComparison.OrdinalIgnoreCase))
        {
            return payload => EvaluateExpression(condition.Expression, payload);
        }

        throw new NotSupportedException($"Condition type \"{condition.Type}\" is not supported.");
    }

    private static bool EvaluateExpression(string? expression, object? payload)
    {
        string trimmed = expression?.Trim() ?? string.Empty;
        if (string.Equals(trimmed, "true", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (string.Equals(trimmed, "false", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (trimmed.Contains("&&", StringComparison.Ordinal))
        {
            return trimmed
                .Split("&&", StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .All(segment => EvaluateExpression(segment, payload));
        }

        if (trimmed.Contains("||", StringComparison.Ordinal))
        {
            return trimmed
                .Split("||", StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Any(segment => EvaluateExpression(segment, payload));
        }

        Match match = ComparisonExpression.Match(trimmed);
        if (!match.Success)
        {
            return false;
        }

        string path = match.Groups["path"].Value;
        string @operator = match.Groups["operator"].Value switch
        {
            "==" => "equals",
            "!=" => "not-equals",
            ">" => "gt",
            "<" => "lt",
            "matches" => "regex",
            _ => match.Groups["operator"].Value,
        };

        string rawValue = match.Groups["value"].Value;
        string value = UnwrapLiteral(rawValue);
        return EvaluateRule(
            new WorkflowConditionRuleDto
            {
                PropertyPath = path,
                Operator = @operator,
                Value = value,
            },
            payload);
    }

    private static bool EvaluateRule(WorkflowConditionRuleDto rule, object? payload)
    {
        if (payload is null || string.IsNullOrWhiteSpace(rule.PropertyPath))
        {
            return false;
        }

        if (!TryResolvePropertyPath(payload, rule.PropertyPath, out object? actualValue))
        {
            return false;
        }

        return rule.Operator switch
        {
            "equals" => AreEqual(actualValue, rule.Value),
            "not-equals" => !AreEqual(actualValue, rule.Value),
            "contains" => ContainsValue(actualValue, rule.Value),
            "gt" => CompareAsNumberOrString(actualValue, rule.Value) > 0,
            "lt" => CompareAsNumberOrString(actualValue, rule.Value) < 0,
            "regex" => Regex.IsMatch(CoerceToString(actualValue), rule.Value, RegexOptions.CultureInvariant),
            _ => false,
        };
    }

    private static bool TryResolvePropertyPath(object payload, string propertyPath, out object? value)
    {
        object? current = payload;
        foreach (string segment in propertyPath.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!TryResolvePropertySegment(current, segment, out current))
            {
                value = null;
                return false;
            }
        }

        value = current;
        return true;
    }

    private static bool TryResolvePropertySegment(object? current, string segment, out object? value)
    {
        value = null;
        if (current is null)
        {
            return false;
        }

        if (current is JsonElement jsonElement)
        {
            if (jsonElement.ValueKind == JsonValueKind.Object)
            {
                foreach (JsonProperty jsonProperty in jsonElement.EnumerateObject())
                {
                    if (string.Equals(jsonProperty.Name, segment, StringComparison.OrdinalIgnoreCase))
                    {
                        value = jsonProperty.Value;
                        return true;
                    }
                }
            }

            return false;
        }

        if (current is IDictionary dictionary)
        {
            foreach (DictionaryEntry entry in dictionary)
            {
                if (entry.Key is string key && string.Equals(key, segment, StringComparison.OrdinalIgnoreCase))
                {
                    value = entry.Value;
                    return true;
                }
            }
        }

        Type type = current.GetType();
        PropertyInfo? property = type.GetProperties(BindingFlags.Instance | BindingFlags.Public)
            .FirstOrDefault(candidate => string.Equals(candidate.Name, segment, StringComparison.OrdinalIgnoreCase));
        if (property is not null)
        {
            value = property.GetValue(current);
            return true;
        }

        return false;
    }

    private static bool AreEqual(object? actualValue, string expectedValue)
    {
        if (actualValue is null)
        {
            return false;
        }

        if (TryConvertToDecimal(actualValue, out decimal actualDecimal)
            && decimal.TryParse(expectedValue, NumberStyles.Float, CultureInfo.InvariantCulture, out decimal expectedDecimal))
        {
            return actualDecimal == expectedDecimal;
        }

        return string.Equals(CoerceToString(actualValue), expectedValue, StringComparison.OrdinalIgnoreCase);
    }

    private static bool ContainsValue(object? actualValue, string expectedValue)
    {
        if (actualValue is null)
        {
            return false;
        }

        if (actualValue is string actualString)
        {
            return actualString.Contains(expectedValue, StringComparison.OrdinalIgnoreCase);
        }

        if (actualValue is IEnumerable enumerable)
        {
            foreach (object? item in enumerable)
            {
                if (string.Equals(CoerceToString(item), expectedValue, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
        }

        return CoerceToString(actualValue).Contains(expectedValue, StringComparison.OrdinalIgnoreCase);
    }

    private static int CompareAsNumberOrString(object? actualValue, string expectedValue)
    {
        if (actualValue is null)
        {
            return -1;
        }

        if (TryConvertToDecimal(actualValue, out decimal actualDecimal)
            && decimal.TryParse(expectedValue, NumberStyles.Float, CultureInfo.InvariantCulture, out decimal expectedDecimal))
        {
            return actualDecimal.CompareTo(expectedDecimal);
        }

        return string.Compare(CoerceToString(actualValue), expectedValue, StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryConvertToDecimal(object? value, out decimal result)
    {
        switch (value)
        {
            case byte byteValue:
                result = byteValue;
                return true;
            case short shortValue:
                result = shortValue;
                return true;
            case int intValue:
                result = intValue;
                return true;
            case long longValue:
                result = longValue;
                return true;
            case float floatValue:
                result = (decimal)floatValue;
                return true;
            case double doubleValue:
                result = (decimal)doubleValue;
                return true;
            case decimal decimalValue:
                result = decimalValue;
                return true;
            case JsonElement jsonElement when jsonElement.ValueKind == JsonValueKind.Number && jsonElement.TryGetDecimal(out decimal jsonDecimal):
                result = jsonDecimal;
                return true;
            default:
                return decimal.TryParse(
                    CoerceToString(value),
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out result);
        }
    }

    private static string CoerceToString(object? value)
    {
        if (value is null)
        {
            return string.Empty;
        }

        if (value is JsonElement jsonElement)
        {
            return jsonElement.ValueKind switch
            {
                JsonValueKind.String => jsonElement.GetString() ?? string.Empty,
                JsonValueKind.True => bool.TrueString,
                JsonValueKind.False => bool.FalseString,
                _ => jsonElement.ToString(),
            };
        }

        return Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty;
    }

    private static string UnwrapLiteral(string rawValue)
    {
        if (rawValue.Length >= 2
            && ((rawValue.StartsWith('"') && rawValue.EndsWith('"'))
                || (rawValue.StartsWith('\'') && rawValue.EndsWith('\''))))
        {
            return rawValue[1..^1];
        }

        return rawValue;
    }
}
