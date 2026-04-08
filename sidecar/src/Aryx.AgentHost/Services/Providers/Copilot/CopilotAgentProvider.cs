using GitHub.Copilot.SDK;
using GitHub.Copilot.SDK.Rpc;
using Aryx.AgentHost.Contracts;

namespace Aryx.AgentHost.Services;

internal sealed class CopilotAgentProvider : IAgentProvider
{
    private const string AskUserToolName = "ask_user";
    private static readonly HashSet<string> ExcludedRuntimeToolNames = new(StringComparer.OrdinalIgnoreCase)
    {
        AskUserToolName,
        "report_intent",
        "task_complete",
    };

    private static readonly string[] AuthenticationErrorIndicators =
    [
        "login",
        "log in",
        "sign in",
        "authenticate",
        "authentication",
        "not signed in",
        "not logged in",
        "reauth",
        "credential",
    ];

    public ITurnWorkflowRunner CreateWorkflowRunner(WorkflowValidator workflowValidator)
    {
        ArgumentNullException.ThrowIfNull(workflowValidator);
        return new AgentWorkflowTurnRunner(new CopilotTurnRunnerSupport(), workflowValidator);
    }

    public Task<SidecarCapabilitiesDto> GetCapabilitiesAsync(CancellationToken cancellationToken)
    {
        return BuildCapabilitiesAsync(cancellationToken);
    }

    public IProviderSessionManager CreateSessionManager()
    {
        return new CopilotSessionManager();
    }

    private static async Task<SidecarCapabilitiesDto> BuildCapabilitiesAsync(CancellationToken cancellationToken)
    {
        try
        {
            CopilotCliContext cliContext = CopilotCliPathResolver.ResolveCliContext();
            CapabilityProbeResult probe = await ProbeCapabilitiesAsync(cliContext, cancellationToken).ConfigureAwait(false);
            return CreateCapabilities(probe.Models, probe.RuntimeTools, probe.Connection);
        }
        catch (Exception exception)
        {
            SidecarConnectionDiagnosticsDto connection = CreateMissingCliDiagnostics(exception);
            Console.Error.WriteLine($"[aryx sidecar] {connection.Summary} {exception.Message}");
            return CreateCapabilities([], [], connection);
        }
    }

    private static async Task<CapabilityProbeResult> ProbeCapabilitiesAsync(
        CopilotCliContext cliContext,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<SidecarModelCapabilityDto> models = [];
        IReadOnlyList<SidecarRuntimeToolDto> runtimeTools = [];
        SidecarCopilotAccountDiagnosticsDto? account = null;
        SidecarCopilotCliVersionDiagnosticsDto? cliVersion = null;
        Task<SidecarCopilotCliVersionDiagnosticsDto> cliVersionTask =
            CopilotConnectionMetadataResolver.GetCliVersionDiagnosticsAsync(cliContext, cancellationToken);

        try
        {
            CopilotClientOptions clientOptions = CopilotCliPathResolver.CreateClientOptions(cliContext);

            await using CopilotClient client = new(clientOptions);
            await client.StartAsync(cancellationToken).ConfigureAwait(false);

            GetAuthStatusResponse? authStatus =
                await CopilotConnectionMetadataResolver.TryGetAuthStatusAsync(client, cancellationToken).ConfigureAwait(false);
            account = await CopilotConnectionMetadataResolver.CreateAccountDiagnosticsAsync(
                    authStatus,
                    cliContext.Environment,
                    cancellationToken)
                .ConfigureAwait(false);

            models = await ListAvailableModelsAsync(client, cancellationToken).ConfigureAwait(false);
            runtimeTools = await TryListAvailableRuntimeToolsAsync(client, cancellationToken).ConfigureAwait(false);
            cliVersion = await cliVersionTask.ConfigureAwait(false);

            return new CapabilityProbeResult(
                models,
                runtimeTools,
                CreateReadyConnectionDiagnostics(cliContext.CliPath, models.Count, cliVersion, account));
        }
        catch (Exception exception)
        {
            cliVersion = await cliVersionTask.ConfigureAwait(false);
            Console.Error.WriteLine($"[aryx sidecar] Failed to list available Copilot models: {exception.Message}");

            return new CapabilityProbeResult(
                models,
                runtimeTools,
                CreateFailureConnectionDiagnostics(cliContext.CliPath, exception, cliVersion, account));
        }
    }

    private static SidecarCapabilitiesDto CreateCapabilities(
        IReadOnlyList<SidecarModelCapabilityDto> models,
        IReadOnlyList<SidecarRuntimeToolDto> runtimeTools,
        SidecarConnectionDiagnosticsDto connection)
    {
        return new SidecarCapabilitiesDto
        {
            Modes = BuildModeCapabilities(),
            Models = models,
            RuntimeTools = runtimeTools,
            Connection = connection,
        };
    }

    private static Dictionary<string, SidecarModeCapabilityDto> BuildModeCapabilities()
    {
        return new Dictionary<string, SidecarModeCapabilityDto>(StringComparer.OrdinalIgnoreCase)
        {
            ["single"] = new() { Available = true },
            ["sequential"] = new() { Available = true },
            ["concurrent"] = new() { Available = true },
            ["handoff"] = new() { Available = true },
            ["group-chat"] = new() { Available = true },
            ["magentic"] = new()
            {
                Available = false,
                Reason = "Microsoft Agent Framework currently documents Magentic orchestration as unsupported in C#.",
            },
        };
    }

    private static async Task<IReadOnlyList<SidecarModelCapabilityDto>> ListAvailableModelsAsync(
        CopilotClient client,
        CancellationToken cancellationToken)
    {
        List<ModelInfo> models = await client.ListModelsAsync(cancellationToken).ConfigureAwait(false);
        return models
            .Select(model => new SidecarModelCapabilityDto
            {
                Id = model.Id,
                Name = model.Name,
                SupportedReasoningEfforts = (model.SupportedReasoningEfforts ?? [])
                    .Where(IsReasoningEffort)
                    .Distinct(StringComparer.Ordinal)
                    .ToList(),
                DefaultReasoningEffort = IsReasoningEffort(model.DefaultReasoningEffort)
                    ? model.DefaultReasoningEffort
                    : null,
            })
            .OrderBy(model => model.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static async Task<IReadOnlyList<SidecarRuntimeToolDto>> TryListAvailableRuntimeToolsAsync(
        CopilotClient client,
        CancellationToken cancellationToken)
    {
        try
        {
            return await ListAvailableRuntimeToolsAsync(client, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"[aryx sidecar] Failed to list available Copilot runtime tools: {exception.Message}");
            return [];
        }
    }

    private static async Task<IReadOnlyList<SidecarRuntimeToolDto>> ListAvailableRuntimeToolsAsync(
        CopilotClient client,
        CancellationToken cancellationToken)
    {
        ToolsListResult result = await client.Rpc.Tools.ListAsync(null!, cancellationToken).ConfigureAwait(false);
        return MapRuntimeTools(result.Tools);
    }

    internal static IReadOnlyList<SidecarRuntimeToolDto> MapRuntimeTools(IEnumerable<Tool> tools)
    {
        return tools
            .Where(ShouldIncludeRuntimeTool)
            .Where(tool => !string.IsNullOrWhiteSpace(tool.Name))
            .Select(tool => new SidecarRuntimeToolDto
            {
                Id = tool.Name.Trim(),
                Label = tool.Name.Trim(),
                Description = string.IsNullOrWhiteSpace(tool.Description) ? null : tool.Description.Trim(),
            })
            .DistinctBy(tool => tool.Id, StringComparer.OrdinalIgnoreCase)
            .OrderBy(tool => tool.Label, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool ShouldIncludeRuntimeTool(Tool tool)
    {
        string? toolName = string.IsNullOrWhiteSpace(tool.Name) ? null : tool.Name.Trim();
        return toolName is not null
            && !ExcludedRuntimeToolNames.Contains(toolName);
    }

    private static bool IsReasoningEffort(string? value)
    {
        return value is "low" or "medium" or "high" or "xhigh";
    }

    internal static SidecarConnectionDiagnosticsDto CreateMissingCliDiagnostics(Exception exception)
    {
        return new SidecarConnectionDiagnosticsDto
        {
            Status = "copilot-cli-missing",
            Summary = "GitHub Copilot CLI is not installed or is not available on PATH.",
            Detail = exception.Message,
            CheckedAt = DateTimeOffset.UtcNow.ToString("O"),
        };
    }

    internal static SidecarConnectionDiagnosticsDto CreateReadyConnectionDiagnostics(
        string cliPath,
        int modelCount,
        SidecarCopilotCliVersionDiagnosticsDto? cliVersion = null,
        SidecarCopilotAccountDiagnosticsDto? account = null)
    {
        string summary = modelCount switch
        {
            0 => "Connected to GitHub Copilot, but no models were reported.",
            1 => "Connected to GitHub Copilot. 1 model is available.",
            _ => $"Connected to GitHub Copilot. {modelCount} models are available.",
        };

        return new SidecarConnectionDiagnosticsDto
        {
            Status = "ready",
            Summary = summary,
            Detail = $"Using Copilot CLI at {cliPath}.",
            CopilotCliPath = cliPath,
            CopilotCliVersion = cliVersion,
            Account = account,
            CheckedAt = DateTimeOffset.UtcNow.ToString("O"),
        };
    }

    internal static SidecarConnectionDiagnosticsDto CreateFailureConnectionDiagnostics(
        string? cliPath,
        Exception exception,
        SidecarCopilotCliVersionDiagnosticsDto? cliVersion = null,
        SidecarCopilotAccountDiagnosticsDto? account = null)
    {
        string status = ClassifyConnectionStatus(exception);
        string summary = status == "copilot-auth-required"
            ? "GitHub Copilot requires authentication before Aryx can load models."
            : "GitHub Copilot was found, but Aryx could not load its model list.";

        return new SidecarConnectionDiagnosticsDto
        {
            Status = status,
            Summary = summary,
            Detail = exception.Message,
            CopilotCliPath = cliPath,
            CopilotCliVersion = cliVersion,
            Account = account,
            CheckedAt = DateTimeOffset.UtcNow.ToString("O"),
        };
    }

    internal static string ClassifyConnectionStatus(Exception exception)
    {
        string message = exception.Message;
        if (AuthenticationErrorIndicators.Any(indicator =>
            message.Contains(indicator, StringComparison.OrdinalIgnoreCase)))
        {
            return "copilot-auth-required";
        }

        return "copilot-error";
    }

    private sealed record CapabilityProbeResult(
        IReadOnlyList<SidecarModelCapabilityDto> Models,
        IReadOnlyList<SidecarRuntimeToolDto> RuntimeTools,
        SidecarConnectionDiagnosticsDto Connection);
}
