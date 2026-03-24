# Tool auto-approval backend handover

## What changed

The backend now supports **tool-specific auto-approval defaults on patterns** plus **per-session overrides**.

This builds on the existing approval-checkpoint system:

- `final-response` approvals still work the same way
- `tool-call` checkpoints still decide **whether a tool call needs approval at all**
- the new feature decides **which known tools can be auto-approved instead of surfacing a manual approval**

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
listApprovalToolDefinitions(workspace.settings.tooling)
```

This is the canonical source for UI rendering and validation.

Each returned item includes:

- `id` → the runtime tool identifier used by approvals
- `label` → human-readable label for the UI
- `kind` → `mcp`, `lsp`, or `mixed`
- `providerIds`
- `providerNames`

Do **not** re-derive tool IDs in the renderer.

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
- workspace load prunes stale tool IDs from patterns and sessions
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
  - canonical `listApprovalToolDefinitions(...)` helper
- `src/shared/domain/session.ts`
  - session approval settings + effective pattern merge helper
- `src/main/EryxAppService.ts`
  - pattern validation, session override IPC handler, tooling cleanup, effective-pattern merge
- `src/main/persistence/workspaceRepository.ts`
  - load-time normalization + pruning for stale tool IDs
- `src/shared/contracts/ipc.ts`
- `src/shared/contracts/channels.ts`
- `src\preload\index.ts`
- `src\main\ipc\registerIpcHandlers.ts`
- `sidecar/src/Eryx.AgentHost/Contracts/ProtocolModels.cs`
- `sidecar/src/Eryx.AgentHost/Services/CopilotWorkflowRunner.cs`
  - tool-name extraction from permission requests
  - tool-specific auto-approval decision

## UX work for the frontend agent

### 1. Pattern editor: default tool auto-approval

In `PatternEditor`, add a section that renders `listApprovalToolDefinitions(workspace.settings.tooling)`.

Recommended behavior:

- show every available approval tool with a toggle
- write the selected tool IDs to `pattern.approvalPolicy.autoApprovedToolNames`
- keep this separate from the existing `tool-call` / `final-response` checkpoint toggles
- if there are no tools, show an empty state instead of an interactive list

### 2. Activity panel: per-session override

In the right-side Activity panel, add a per-session auto-approval section for tools.

Recommended behavior:

- base the list on `listApprovalToolDefinitions(workspace.settings.tooling)`
- show the current **effective** state
- distinguish inherited vs overridden state in the UI
- allow resetting the session to inherit the pattern defaults
- call `updateSessionApprovalSettings(...)` when the user changes the override

Suggested UX:

- `Inheriting pattern defaults` badge/state when `session.approvalSettings` is `undefined`
- `Custom for this session` badge/state when the override object exists
- `Reset to pattern` action that calls `updateSessionApprovalSettings({ sessionId })`

### 3. Disable while running

Match the current tools behavior:

- disable the per-session override controls while `session.status === 'running'`
- scratchpad sessions should show a non-interactive explanation because tool auto-approval does not apply there

### 4. Surface tool context in approval UI

Optional but recommended:

- show `approval.toolName` in the active approval banner / queued approval list when present
- this is now available for tool-specific approval requests

### 5. Avoid ID duplication logic in the renderer

Important:

- do not manually rebuild LSP tool IDs in UI code
- use the shared helper output and persist the `id` values from it

## Validation commands

Backend changes were validated with:

- `bun run typecheck`
- `bun test`
- `bun run sidecar:test`
- `bun run build`
