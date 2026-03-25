using System.Collections.Concurrent;
using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Aryx.AgentHost.Contracts;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Services;

internal sealed class LspToolSession : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonSerializerOptions();

    private readonly RunTurnLspProfileConfigDto _profile;
    private readonly string _projectPath;
    private readonly Process _process;
    private readonly Stream _stdin;
    private readonly Stream _stdout;
    private readonly CancellationTokenSource _cts = new();
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement?>> _pending =
        new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly SemaphoreSlim _documentLock = new(1, 1);
    private readonly HashSet<string> _openedDocumentUris = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentQueue<string> _stderrLines = new();
    private readonly Task _stdoutReaderTask;
    private readonly Task _stderrReaderTask;
    private int _nextRequestId;

    private LspToolSession(
        RunTurnLspProfileConfigDto profile,
        string projectPath,
        Process process)
    {
        _profile = profile;
        _projectPath = Path.GetFullPath(projectPath);
        _process = process;
        _stdin = process.StandardInput.BaseStream;
        _stdout = process.StandardOutput.BaseStream;
        _stdoutReaderTask = Task.Run(() => ReadLoopAsync(_cts.Token));
        _stderrReaderTask = Task.Run(() => ReadErrorLoopAsync(_cts.Token));
        Tools =
        [
            CreateTool(
                methodName: nameof(WorkspaceSymbolsToolAsync),
                toolName: $"{BuildToolPrefix(_profile.Id)}_workspace_symbols",
                description: $"Search workspace symbols using the {_profile.Name} language server. Use this when you know a symbol name or partial symbol name."),
            CreateTool(
                methodName: nameof(DocumentSymbolsToolAsync),
                toolName: $"{BuildToolPrefix(_profile.Id)}_document_symbols",
                description: $"List document symbols for a file using the {_profile.Name} language server. Pass a path relative to the current project root."),
            CreateTool(
                methodName: nameof(DefinitionToolAsync),
                toolName: $"{BuildToolPrefix(_profile.Id)}_definition",
                description: $"Resolve the definition location for a symbol using the {_profile.Name} language server. Paths are relative to the project root. Line and character are 1-based."),
            CreateTool(
                methodName: nameof(HoverToolAsync),
                toolName: $"{BuildToolPrefix(_profile.Id)}_hover",
                description: $"Fetch hover information for a symbol using the {_profile.Name} language server. Paths are relative to the project root. Line and character are 1-based."),
            CreateTool(
                methodName: nameof(ReferencesToolAsync),
                toolName: $"{BuildToolPrefix(_profile.Id)}_references",
                description: $"Find references for a symbol using the {_profile.Name} language server. Paths are relative to the project root. Line and character are 1-based."),
        ];
    }

    public IReadOnlyList<AIFunction> Tools { get; }

    internal static JsonSerializerOptions CreateJsonSerializerOptions()
    {
        JsonSerializerOptions options = new(JsonSerializerDefaults.Web)
        {
            TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = true,
        };

        options.MakeReadOnly();
        return options;
    }

    public static async Task<LspToolSession> StartAsync(
        RunTurnLspProfileConfigDto profile,
        string projectPath,
        CancellationToken cancellationToken)
    {
        ProcessStartInfo startInfo = new()
        {
            FileName = profile.Command,
            WorkingDirectory = projectPath,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        foreach (string arg in ResolveProcessArguments(profile))
        {
            startInfo.ArgumentList.Add(arg);
        }

        Process? process;
        try
        {
            process = Process.Start(startInfo);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"Could not start LSP profile \"{profile.Name}\" using command \"{profile.Command}\".",
                ex);
        }

        if (process is null)
        {
            throw new InvalidOperationException(
                $"Could not start LSP profile \"{profile.Name}\" using command \"{profile.Command}\".");
        }

        LspToolSession session = new(profile, projectPath, process);
        await session.InitializeAsync(cancellationToken).ConfigureAwait(false);
        return session;
    }

    internal static IReadOnlyList<string> ResolveProcessArguments(RunTurnLspProfileConfigDto profile)
    {
        List<string> args = profile.Args.ToList();

        if (UsesTypeScriptLanguageServer(profile.Command)
            && !args.Any(arg => string.Equals(arg, "--stdio", StringComparison.OrdinalIgnoreCase)))
        {
            args.Add("--stdio");
        }

        return args;
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();

        try
        {
            if (!_process.HasExited)
            {
                _process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
        }

        try
        {
            await _stdoutReaderTask.ConfigureAwait(false);
        }
        catch
        {
        }

        try
        {
            await _stderrReaderTask.ConfigureAwait(false);
        }
        catch
        {
        }

        _writeLock.Dispose();
        _documentLock.Dispose();
        _stdin.Dispose();
        _stdout.Dispose();
        _process.Dispose();
        _cts.Dispose();
    }

    private async Task InitializeAsync(CancellationToken cancellationToken)
    {
        string rootUri = ToFileUri(_projectPath);
        await SendRequestAsync(
            "initialize",
            new
            {
                processId = Environment.ProcessId,
                rootUri,
                capabilities = new { },
                workspaceFolders = new[]
                {
                    new
                    {
                        uri = rootUri,
                        name = Path.GetFileName(_projectPath),
                    },
                },
                clientInfo = new
                {
                    name = "Aryx",
                    version = "1.0.0",
                },
            },
            cancellationToken).ConfigureAwait(false);

        await SendNotificationAsync("initialized", new { }, cancellationToken).ConfigureAwait(false);
    }

    private AIFunction CreateTool(string methodName, string toolName, string description)
    {
        MethodInfo method = GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException($"LSP tool method \"{methodName}\" was not found.");

        return AIFunctionFactory.Create(
            method,
            this,
            new AIFunctionFactoryOptions
            {
                Name = toolName,
                Description = description,
                SerializerOptions = JsonOptions,
            });
    }

    private async Task<string> WorkspaceSymbolsToolAsync(string query, int limit = 20)
    {
        JsonElement? result = await SendRequestAsync(
            "workspace/symbol",
            new
            {
                query,
            },
            CancellationToken.None).ConfigureAwait(false);

        return SerializeResult(result, limit);
    }

    private async Task<string> DocumentSymbolsToolAsync(string relativePath)
    {
        string documentPath = ResolveProjectPath(relativePath);
        string documentUri = await EnsureDocumentOpenedAsync(documentPath, CancellationToken.None)
            .ConfigureAwait(false);

        JsonElement? result = await SendRequestAsync(
            "textDocument/documentSymbol",
            new
            {
                textDocument = new
                {
                    uri = documentUri,
                },
            },
            CancellationToken.None).ConfigureAwait(false);

        return SerializeResult(result);
    }

    private async Task<string> DefinitionToolAsync(string relativePath, int line, int character)
    {
        string documentPath = ResolveProjectPath(relativePath);
        string documentUri = await EnsureDocumentOpenedAsync(documentPath, CancellationToken.None)
            .ConfigureAwait(false);

        JsonElement? result = await SendRequestAsync(
            "textDocument/definition",
            new
            {
                textDocument = new
                {
                    uri = documentUri,
                },
                position = new
                {
                    line = NormalizePosition(line),
                    character = NormalizePosition(character),
                },
            },
            CancellationToken.None).ConfigureAwait(false);

        return SerializeResult(result);
    }

    private async Task<string> HoverToolAsync(string relativePath, int line, int character)
    {
        string documentPath = ResolveProjectPath(relativePath);
        string documentUri = await EnsureDocumentOpenedAsync(documentPath, CancellationToken.None)
            .ConfigureAwait(false);

        JsonElement? result = await SendRequestAsync(
            "textDocument/hover",
            new
            {
                textDocument = new
                {
                    uri = documentUri,
                },
                position = new
                {
                    line = NormalizePosition(line),
                    character = NormalizePosition(character),
                },
            },
            CancellationToken.None).ConfigureAwait(false);

        return SerializeResult(result);
    }

    private async Task<string> ReferencesToolAsync(string relativePath, int line, int character)
    {
        string documentPath = ResolveProjectPath(relativePath);
        string documentUri = await EnsureDocumentOpenedAsync(documentPath, CancellationToken.None)
            .ConfigureAwait(false);

        JsonElement? result = await SendRequestAsync(
            "textDocument/references",
            new
            {
                textDocument = new
                {
                    uri = documentUri,
                },
                position = new
                {
                    line = NormalizePosition(line),
                    character = NormalizePosition(character),
                },
                context = new
                {
                    includeDeclaration = true,
                },
            },
            CancellationToken.None).ConfigureAwait(false);

        return SerializeResult(result);
    }

    private async Task<string> EnsureDocumentOpenedAsync(string documentPath, CancellationToken cancellationToken)
    {
        string documentUri = ToFileUri(documentPath);

        if (_openedDocumentUris.Contains(documentUri))
        {
            return documentUri;
        }

        await _documentLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_openedDocumentUris.Contains(documentUri))
            {
                return documentUri;
            }

            string text = await File.ReadAllTextAsync(documentPath, cancellationToken).ConfigureAwait(false);
            await SendNotificationAsync(
                "textDocument/didOpen",
                new
                {
                    textDocument = new
                    {
                        uri = documentUri,
                        languageId = ResolveLanguageId(documentPath),
                        version = 1,
                        text,
                    },
                },
                cancellationToken).ConfigureAwait(false);

            _openedDocumentUris.Add(documentUri);
            return documentUri;
        }
        finally
        {
            _documentLock.Release();
        }
    }

    private async Task<JsonElement?> SendRequestAsync(
        string method,
        object? parameters,
        CancellationToken cancellationToken)
    {
        int requestId = Interlocked.Increment(ref _nextRequestId);
        TaskCompletionSource<JsonElement?> tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending[requestId] = tcs;

        await WriteMessageAsync(
            new
            {
                jsonrpc = "2.0",
                id = requestId,
                method,
                @params = parameters,
            },
            cancellationToken).ConfigureAwait(false);

        using CancellationTokenRegistration registration = cancellationToken.Register(
            static state =>
            {
                ((TaskCompletionSource<JsonElement?>)state!).TrySetCanceled();
            },
            tcs);

        try
        {
            return await tcs.Task.ConfigureAwait(false);
        }
        finally
        {
            _pending.TryRemove(requestId, out _);
        }
    }

    private Task SendNotificationAsync(string method, object? parameters, CancellationToken cancellationToken)
    {
        return WriteMessageAsync(
            new
            {
                jsonrpc = "2.0",
                method,
                @params = parameters,
            },
            cancellationToken);
    }

    private async Task WriteMessageAsync(object payload, CancellationToken cancellationToken)
    {
        string json = JsonSerializer.Serialize(payload, JsonOptions);
        byte[] body = Encoding.UTF8.GetBytes(json);
        byte[] header = Encoding.ASCII.GetBytes($"Content-Length: {body.Length}\r\n\r\n");

        await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await _stdin.WriteAsync(header, cancellationToken).ConfigureAwait(false);
            await _stdin.WriteAsync(body, cancellationToken).ConfigureAwait(false);
            await _stdin.FlushAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private async Task ReadLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                Dictionary<string, string>? headers = await ReadHeadersAsync(_stdout, cancellationToken)
                    .ConfigureAwait(false);
                if (headers is null)
                {
                    break;
                }

                if (!headers.TryGetValue("Content-Length", out string? contentLengthHeader)
                    || !int.TryParse(contentLengthHeader, out int contentLength))
                {
                    throw new InvalidOperationException("LSP response was missing a valid Content-Length header.");
                }

                byte[] body = await ReadExactAsync(_stdout, contentLength, cancellationToken).ConfigureAwait(false);
                using JsonDocument document = JsonDocument.Parse(body);
                JsonElement root = document.RootElement;

                if (root.TryGetProperty("id", out JsonElement idElement)
                    && TryReadRequestId(idElement, out int requestId)
                    && _pending.TryGetValue(requestId, out TaskCompletionSource<JsonElement?>? tcs))
                {
                    if (root.TryGetProperty("error", out JsonElement errorElement))
                    {
                        string message = errorElement.TryGetProperty("message", out JsonElement messageElement)
                            ? messageElement.GetString() ?? "Unknown LSP error."
                            : "Unknown LSP error.";
                        tcs.TrySetException(new InvalidOperationException(message));
                    }
                    else if (root.TryGetProperty("result", out JsonElement resultElement))
                    {
                        tcs.TrySetResult(resultElement.Clone());
                    }
                    else
                    {
                        tcs.TrySetResult(null);
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            FailPendingRequests(ex);
        }
        finally
        {
            FailPendingRequests(CreatePendingRequestInterruptedException());
        }
    }

    private async Task ReadErrorLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                string? line = await _process.StandardError.ReadLineAsync(cancellationToken).ConfigureAwait(false);
                if (line is null)
                {
                    break;
                }

                if (!string.IsNullOrWhiteSpace(line))
                {
                    RecordStderrLine(line);
                    Console.Error.WriteLine($"[aryx lsp:{_profile.Id}] {line}");
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private static async Task<Dictionary<string, string>?> ReadHeadersAsync(
        Stream stream,
        CancellationToken cancellationToken)
    {
        List<byte> bytes = [];
        byte[] buffer = new byte[1];

        while (true)
        {
            int read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                return bytes.Count == 0
                    ? null
                    : throw new EndOfStreamException("LSP stream ended mid-header.");
            }

            bytes.Add(buffer[0]);
            int count = bytes.Count;
            if (count >= 4
                && bytes[count - 4] == '\r'
                && bytes[count - 3] == '\n'
                && bytes[count - 2] == '\r'
                && bytes[count - 1] == '\n')
            {
                break;
            }
        }

        string headerText = Encoding.ASCII.GetString(bytes.Take(bytes.Count - 4).ToArray());
        Dictionary<string, string> headers = new(StringComparer.OrdinalIgnoreCase);
        foreach (string line in headerText.Split("\r\n", StringSplitOptions.RemoveEmptyEntries))
        {
            int separatorIndex = line.IndexOf(':');
            if (separatorIndex < 0)
            {
                continue;
            }

            string key = line[..separatorIndex].Trim();
            string value = line[(separatorIndex + 1)..].Trim();
            headers[key] = value;
        }

        return headers;
    }

    private static async Task<byte[]> ReadExactAsync(
        Stream stream,
        int length,
        CancellationToken cancellationToken)
    {
        byte[] buffer = new byte[length];
        int offset = 0;

        while (offset < length)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(offset, length - offset), cancellationToken)
                .ConfigureAwait(false);
            if (read == 0)
            {
                throw new EndOfStreamException("LSP stream ended mid-message.");
            }

            offset += read;
        }

        return buffer;
    }

    private static bool TryReadRequestId(JsonElement idElement, out int requestId)
    {
        requestId = default;
        return idElement.ValueKind switch
        {
            JsonValueKind.Number => idElement.TryGetInt32(out requestId),
            JsonValueKind.String => int.TryParse(idElement.GetString(), out requestId),
            _ => false,
        };
    }

    private void FailPendingRequests(Exception exception)
    {
        foreach ((_, TaskCompletionSource<JsonElement?> tcs) in _pending.ToArray())
        {
            tcs.TrySetException(exception);
        }

        _pending.Clear();
    }

    private void RecordStderrLine(string line)
    {
        _stderrLines.Enqueue(line);
        while (_stderrLines.Count > 8 && _stderrLines.TryDequeue(out _))
        {
        }
    }

    private InvalidOperationException CreatePendingRequestInterruptedException()
    {
        string message = $"LSP profile \"{_profile.Name}\" stopped before a pending request completed.";
        string[] stderrLines = _stderrLines.ToArray();

        if (stderrLines.Length == 0)
        {
            return new InvalidOperationException(message);
        }

        string detail = string.Join(" ", stderrLines.TakeLast(3));
        return new InvalidOperationException($"{message} Last stderr: {detail}");
    }

    private string ResolveProjectPath(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            throw new InvalidOperationException("A project-relative path is required.");
        }

        string fullPath = Path.IsPathRooted(relativePath)
            ? Path.GetFullPath(relativePath)
            : Path.GetFullPath(Path.Combine(_projectPath, relativePath));

        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException($"Could not find \"{relativePath}\" in the current project.", fullPath);
        }

        string normalizedProjectPath = Path.TrimEndingDirectorySeparator(_projectPath);
        if (!fullPath.StartsWith(normalizedProjectPath, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("LSP tools can only access files inside the current project.");
        }

        return fullPath;
    }

    private string ResolveLanguageId(string documentPath)
    {
        string extension = Path.GetExtension(documentPath);
        if (_profile.FileExtensions.Any(candidate =>
                string.Equals(candidate, extension, StringComparison.OrdinalIgnoreCase)))
        {
            return _profile.LanguageId;
        }

        return _profile.LanguageId;
    }

    private static string BuildToolPrefix(string value)
    {
        StringBuilder builder = new();
        foreach (char ch in value)
        {
            if (char.IsLetterOrDigit(ch))
            {
                builder.Append(char.ToLowerInvariant(ch));
                continue;
            }

            if (builder.Length == 0 || builder[^1] == '_')
            {
                continue;
            }

            builder.Append('_');
        }

        string prefix = builder.ToString().Trim('_');
        return string.IsNullOrWhiteSpace(prefix) ? "lsp" : $"lsp_{prefix}";
    }

    private static int NormalizePosition(int value)
    {
        return Math.Max(value - 1, 0);
    }

    private static bool UsesTypeScriptLanguageServer(string command)
    {
        string executableName = Path.GetFileName(command.Trim()).ToLowerInvariant();
        return executableName is "typescript-language-server"
            or "typescript-language-server.cmd"
            or "typescript-language-server.exe";
    }

    private static string ToFileUri(string path)
    {
        return new Uri(path).AbsoluteUri;
    }

    private static string SerializeResult(JsonElement? result, int? maxItems = null)
    {
        if (result is null)
        {
            return "null";
        }

        JsonElement output = result.Value;
        if (maxItems.HasValue && output.ValueKind == JsonValueKind.Array)
        {
            JsonElement[] limited = output.EnumerateArray().Take(Math.Max(maxItems.Value, 0)).ToArray();
            return JsonSerializer.Serialize(limited, JsonOptions);
        }

        return JsonSerializer.Serialize(output, JsonOptions);
    }
}
