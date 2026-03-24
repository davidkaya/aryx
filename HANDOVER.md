# Tool auto-approval backend handover

## What changed

The backend now supports **tool-specific auto-approval defaults on patterns** plus **per-session overrides**.

This builds on the existing approval-checkpoint system:

- `final-response` approvals still work the same way
- `tool-call` checkpoints still decide **whether a tool call needs approval at all**
- the new feature decides **which known runtime tools can be auto-approved instead of surfacing a manual approval**

The approval queue work from earlier is unchanged and still applies.

## Shared model

### Pattern-level defaults

Pattern defaults now live on `pattern.approvalPolicy.autoApprovedToolNames`.

```ts
interface ApprovalPolicy {
  rules: ApprovalCheckpointRule[];
  autoApprovedToolNames?: string[];
}
```

Important:

- this list stores **runtime tool identifiers**, not display labels
- it is independent from the `rules` list
- a pattern may store tool auto-approval defaults even if `tool-call` checkpoints are currently disabled

If `tool-call` approvals are not enabled for the relevant agent, the tool auto-approval list has no runtime effect.

### Per-session override

Sessions now support an optional override object:

```ts
interface SessionApprovalSettings {
  autoApprovedToolNames: string[];
}

interface SessionRecord {
  approvalSettings?: SessionApprovalSettings;
}
```

Semantics:

- `session.approvalSettings === undefined` → inherit the pattern defaults
- `session.approvalSettings.autoApprovedToolNames = []` → explicit session override that auto-approves **nothing**
- non-empty `autoApprovedToolNames` → explicit session override list

Session overrides replace the pattern's tool auto-approval list for that session. They do **not** merge.

## Runtime behavior

The main process now applies session approval overrides before sending the pattern to the sidecar.

That means the sidecar sees the **effective** approval policy for the session:

- pattern rules
- pattern defaults when no session override exists
- session override list when present

Actual decision flow for a tool call is now:

1. Is `tool-call` approval enabled for this agent by `approvalPolicy.rules`?
2. If not, auto-approve as before.
3. If yes, is the runtime `toolName` in the effective `autoApprovedToolNames` list?
4. If yes, auto-approve without creating a pending approval.
5. Otherwise, emit a normal approval request and pause for user action.

Unknown or non-tool-specific permission requests still require manual approval when `tool-call` checkpoints are active.

## Tool identity contract

Use the shared helper in `src/shared/domain/tooling.ts`:

```ts
listApprovalToolDefinitions(workspace.settings.tooling, sidecarCapabilities?.runtimeTools)
```

This is the canonical source for UI rendering and validation.

Important:

- runtime tools should come from `describeSidecarCapabilities().runtimeTools` when available
- the shared helper falls back to a conservative built-in catalog until capabilities load or when the CLI cannot report tools
- the helper also merges configured MCP server tools and derived LSP tools

Each returned item includes:

- `id` → the runtime tool identifier used by approvals
- `label` → human-readable label for the UI
- `kind` → `builtin`, `mcp`, `lsp`, or `mixed`
- `providerIds`
- `providerNames`

Do **not** re-derive tool IDs in the renderer.

### Runtime tool IDs

For Copilot CLI runtime tools, the ID is the tool name returned by the sidecar capability payload.

Examples:

- `web_fetch`
- `view`
- `glob`

Descriptions come from the sidecar when available and can be surfaced in the UI.

### MCP tool IDs

For MCP tools, the runtime ID is the raw tool name from `server.tools`.

Example:

```ts
{
  id: "git.status",
  label: "git.status",
  kind: "mcp"
}
```

### LSP tool IDs

For LSP tools, the runtime ID is derived from the profile ID and operation name.

Current operations:

- `workspace_symbols`
- `document_symbols`
- `definition`
- `hover`
- `references`

Example for profile ID `ts`:

- `lsp_ts_workspace_symbols`
- `lsp_ts_document_symbols`
- `lsp_ts_definition`
- `lsp_ts_hover`
- `lsp_ts_references`

Again: the renderer should consume the helper output instead of rebuilding these strings manually.

## New IPC

Renderer access is now available through:

```ts
updateSessionApprovalSettings({
  sessionId: string;
  autoApprovedToolNames?: string[];
}): Promise<WorkspaceState>
```

Semantics:

- omit `autoApprovedToolNames` to clear the override and inherit the pattern defaults
- pass `[]` to keep an explicit session override with no auto-approved tools
- pass a populated array to set an explicit session override list

The existing `savePattern(...)` path is still used for pattern defaults.

## Validation and repair rules

The backend now enforces and maintains tool references consistently:

- saving a pattern rejects unknown `autoApprovedToolNames`
- updating session approval settings rejects unknown tool IDs
- scratchpad sessions reject non-empty session tool auto-approval overrides
- workspace load normalizes approval state and the app service prunes stale tool IDs after runtime tools/capabilities are available
- saving or deleting MCP/LSP definitions also prunes stale tool IDs from patterns and sessions

This is intentional: stored approval defaults should only reference tools that still exist.

## Approval request payload changes

When the sidecar can identify the specific tool, `approval-requested` events now include `toolName`.

Tool-call approval titles/details are also more specific when the tool is known.

Examples:

- title: `Approve lsp_ts_hover`
- detail: `Primary requested custom tool permission for tool "lsp_ts_hover" in Copilot session ...`

Existing UI can keep working without changes, but the UX agent can now surface better tool context.

## Files changed

- `src/shared/domain/approval.ts`
  - pattern defaults, session override model, effective-policy helpers, pruning/validation helpers
- `src/shared/domain/tooling.ts`
  - canonical merged runtime/MCP/LSP `listApprovalToolDefinitions(...)` helper
- `src/shared/contracts/sidecar.ts`
  - runtime tool capability payload
- `src/shared/domain/session.ts`
  - session approval settings + effective pattern merge helper
- `src/main/EryxAppService.ts`
  - pattern validation, session override IPC handler, tooling cleanup, effective-pattern merge
- `src/main/persistence/workspaceRepository.ts`
  - load-time normalization without prematurely pruning dynamic runtime tool IDs
- `sidecar/src/Eryx.AgentHost/Services/SidecarProtocolHost.cs`
  - dynamic Copilot CLI runtime tool discovery via `tools.list`
- `src/shared/contracts/ipc.ts`
- `src/shared/contracts/channels.ts`
- `src\preload\index.ts`
- `src\main\ipc\registerIpcHandlers.ts`
- `sidecar/src/Eryx.AgentHost/Contracts/ProtocolModels.cs`
- `sidecar/src/Eryx.AgentHost/Services/CopilotWorkflowRunner.cs`
  - tool-name extraction from permission requests
  - tool-specific auto-approval decision

## UX work for the frontend agent

All UX tasks from this section have been implemented in commit `4ff5cbb`.

### 1. Pattern editor: default tool auto-approval — ✅ Done

`PatternEditor` renders `listApprovalToolDefinitions(workspace.settings.tooling, sidecarCapabilities?.runtimeTools)` with toggles writing to `pattern.approvalPolicy.autoApprovedToolNames`. Runtime tools come from the sidecar when available and fall back to the shared built-in catalog until capabilities load.

### 2. Activity panel: per-session override — ✅ Done

Right-side Activity panel shows "Inheriting pattern defaults" / "Custom for this session" badge with "Reset to pattern" action. Toggle rows for each tool call `updateSessionApprovalSettings(...)`.

### 3. Disable while running — ✅ Done

Per-session override controls disabled when `session.status === 'running'`. Scratchpad shows non-interactive explanation.

### 4. Surface tool context in approval UI — ✅ Done

`approval.toolName` displayed in both the active approval banner and queued approval list when present.

### 5. Avoid ID duplication logic in the renderer — ✅ Done

All tool ID resolution uses `listApprovalToolDefinitions()` output exclusively.

## Validation commands

Backend changes were validated with:

- `bun run typecheck`
- `bun test`
- `bun run sidecar:test`
- `bun run build`
