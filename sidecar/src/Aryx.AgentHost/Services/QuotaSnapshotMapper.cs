using System.Text.Json;
using Aryx.AgentHost.Contracts;
using GitHub.Copilot.SDK.Rpc;

namespace Aryx.AgentHost.Services;

internal static class QuotaSnapshotMapper
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    public static Dictionary<string, QuotaSnapshotDto> Map(
        IReadOnlyDictionary<string, AccountGetQuotaResultQuotaSnapshotsValue>? snapshots)
    {
        Dictionary<string, QuotaSnapshotDto> mapped = new(StringComparer.Ordinal);
        if (snapshots is null)
        {
            return mapped;
        }

        foreach ((string key, AccountGetQuotaResultQuotaSnapshotsValue snapshot) in snapshots)
        {
            if (string.IsNullOrWhiteSpace(key))
            {
                continue;
            }

            mapped[key.Trim()] = Map(snapshot);
        }

        return mapped;
    }

    public static Dictionary<string, QuotaSnapshotDto>? MapOrNull(
        IReadOnlyDictionary<string, object>? snapshots)
    {
        if (snapshots is not { Count: > 0 })
        {
            return null;
        }

        Dictionary<string, QuotaSnapshotDto> mapped = new(StringComparer.Ordinal);
        foreach ((string key, object snapshot) in snapshots)
        {
            if (string.IsNullOrWhiteSpace(key))
            {
                continue;
            }

            QuotaSnapshotDto? mappedSnapshot = TryMap(snapshot);
            if (mappedSnapshot is null)
            {
                continue;
            }

            mapped[key.Trim()] = mappedSnapshot;
        }

        return mapped.Count == 0 ? null : mapped;
    }

    public static QuotaSnapshotDto Map(AccountGetQuotaResultQuotaSnapshotsValue snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        return new QuotaSnapshotDto
        {
            EntitlementRequests = snapshot.EntitlementRequests,
            UsedRequests = snapshot.UsedRequests,
            RemainingPercentage = snapshot.RemainingPercentage,
            Overage = snapshot.Overage,
            OverageAllowedWithExhaustedQuota = snapshot.OverageAllowedWithExhaustedQuota,
            ResetDate = snapshot.ResetDate,
        };
    }

    private static QuotaSnapshotDto? TryMap(object? snapshot)
    {
        if (snapshot is null)
        {
            return null;
        }

        if (snapshot is AccountGetQuotaResultQuotaSnapshotsValue typedSnapshot)
        {
            return Map(typedSnapshot);
        }

        JsonElement element = snapshot is JsonElement jsonElement
            ? jsonElement
            : JsonSerializer.SerializeToElement(snapshot, JsonOptions);

        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        AccountGetQuotaResultQuotaSnapshotsValue? deserialized =
            element.Deserialize<AccountGetQuotaResultQuotaSnapshotsValue>(JsonOptions);

        return deserialized is null ? null : Map(deserialized);
    }
}
