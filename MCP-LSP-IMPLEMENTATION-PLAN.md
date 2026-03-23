# MCP / LSP Support Implementation Plan

Status: implemented v1 architecture reference

Intended execution order:

1. Backend agent executes backend phases first.
2. Frontend agent executes frontend phases second.
3. Frontend work should begin only after the backend contracts, persistence, and diagnostics are stable.

## Objective

Add first-class support for MCP servers and LSP-backed project intelligence in Eryx without fighting the existing architecture. The design should preserve Eryx's current strengths:

- Electron main as the desktop control plane
- preload + typed IPC as the renderer boundary
- shared TS contracts mirrored into the .NET sidecar
- .NET sidecar as the agent runtime
- OS keychain storage for secrets

This plan is intentionally backend-first and split into backend/frontend task groups so different agents can execute them in order.

The clarified product direction for v1 is:

- users add MCPs and LSPs globally in app settings
- users enable or disable those global MCPs/LSPs per session in the right-side panel that is currently used for activity
- enabled tooling becomes available to the agent for that session

## Current state analysis

### Application architecture today

- `src/main/EryxAppService.ts`
  - central orchestration layer for workspace persistence, project/session lifecycle, sidecar calls, git refresh, and event emission
- `src/main/ipc/registerIpcHandlers.ts`
  - single place where Electron IPC methods are registered
- `src/preload/index.ts`
  - exposes the typed `eryxApi` bridge to the renderer
- `src/renderer/App.tsx`
  - loads workspace + sidecar capabilities and wires subscriptions into the UI
- `src/shared/contracts/ipc.ts`
  - typed renderer/main API contract
- `src/shared/contracts/sidecar.ts`
  - typed main/sidecar protocol contract
- `sidecar/src/Eryx.AgentHost/Contracts/ProtocolModels.cs`
  - C# mirror of the sidecar DTOs
- `sidecar/src/Eryx.AgentHost/Services/SidecarProtocolHost.cs`
  - sidecar command dispatcher and capability provider
- `sidecar/src/Eryx.AgentHost/Services/CopilotWorkflowRunner.cs`
  - actual agent runtime construction and activity emission

### Signals that matter for MCP

- `CopilotWorkflowRunner.cs` already loads `McpServerToolCallContent` via reflection and reports MCP tool names through `TryGetToolName(...)`.
- `CopilotWorkflowRunner.cs` builds a `SessionConfig` for each agent and already owns `AvailableTools`, `WorkingDirectory`, and `OnPermissionRequest`.
- Scratchpad explicitly clears `AvailableTools`, so scratchpad is currently a "no tools" product surface.

### Signals that matter for LSP

- `package.json` includes `typescript-language-server` and an `lsp:typescript` script, which is a good TypeScript-first bootstrap hint.
- For v1, the implemented design starts LSP processes inside the sidecar as turn-scoped tool sessions so they can surface directly as agent tools without inventing a second bridge layer.
- The current session's project root remains the source of truth for LSP initialization.

### Persistence and secrets today

- `src/main/persistence/workspaceRepository.ts` persists a single additive `workspace.json`.
- `src/shared/domain/workspace.ts` defines the root persisted shape.
- `src/shared/domain/session.ts` already carries session-scoped overrides such as `scratchpadConfig`, which makes it the natural place for per-session MCP/LSP enablement.
- `src/main/secrets/secretStore.ts` already wraps `keytar`, so secrets should stay in the OS keychain and never be stored in `workspace.json`.

### Activity and diagnostics today

- `src/shared/domain/event.ts` only exposes coarse activity today: `thinking`, `tool-calling`, `handoff`, `completed`.
- `src/renderer/components/ActivityPanel.tsx` can already show per-agent activity but not rich MCP/LSP traces.
- `src/renderer/components/CopilotStatusCard.tsx` and `SettingsPanel.tsx` already establish a diagnostics-first UX pattern worth reusing for MCP/LSP health surfaces.

## Recommended design decisions

### 1. Put global tooling definitions in workspace settings

Additive, non-secret config should live in `WorkspaceState`, for example through a new `settings.tooling` section.

Illustrative shape:

```ts
interface WorkspaceState {
  projects: ProjectRecord[];
  patterns: PatternDefinition[];
  sessions: SessionRecord[];
  selectedProjectId?: string;
  selectedPatternId?: string;
  selectedSessionId?: string;
  lastUpdatedAt: string;
  settings?: WorkspaceSettings;
}

interface WorkspaceSettings {
  tooling?: {
    mcpServers?: McpServerDefinition[];
    lspProfiles?: LspProfileDefinition[];
  };
}
```

Why this fits:

- it follows the current single-workspace persistence model
- in the current architecture, that single local workspace file already behaves like the app-wide store on this computer
- it remains backward compatible because the new fields are optional
- it keeps MCP/LSP definitions reusable across future sessions

### 2. Put enable/disable state on `SessionRecord`

The user wants MCP/LSP enablement to be controlled per session from the right-side panel. That means the durable selection should live on `SessionRecord`, not on `ProjectRecord`.

Illustrative shape:

```ts
interface SessionRecord {
  id: string;
  projectId: string;
  patternId: string;
  title: string;
  titleSource?: SessionTitleSource;
  createdAt: string;
  updatedAt: string;
  status: SessionStatus;
  isPinned?: boolean;
  isArchived?: boolean;
  messages: ChatMessageRecord[];
  lastError?: string;
  scratchpadConfig?: ScratchpadSessionConfig;
  tooling?: {
    enabledMcpServerIds?: string[];
    enabledLspProfileIds?: string[];
  };
}
```

How this should behave:

- the settings screen owns the global registry of MCP and LSP definitions
- the session panel owns which global definitions are enabled for the current session
- the session's `projectId` provides the project root for LSP initialization when the session is project-backed
- scratchpad sessions should remain tool-free unless explicitly expanded later

### 3. Keep secrets out of persisted JSON

Use `src/main/secrets/secretStore.ts` for secret material. Persist only references in workspace config.

Recommended rule set:

- `workspace.json` stores server/profile definitions and secret references
- `keytar` stores secret values
- runtime logs, process IDs, and raw diagnostics stay out of `workspace.json`

### 4. MCP belongs in the .NET sidecar runtime

The sidecar already owns agent session creation, tool attachment, permission callbacks, and tool-call activity detection. MCP should build on that instead of inventing a second runtime stack in Electron or the renderer.

Recommended flow:

1. Electron main resolves session-enabled MCP definitions.
2. `EryxAppService.sendSessionMessage()` enriches the `run-turn` payload with runtime-ready MCP config.
3. The sidecar attaches MCP tools during `SessionConfig` creation.
4. The sidecar emits richer activity and error events back through the existing streaming channel.

### 5. LSP process ownership should start in the sidecar for v1

Implemented v1 LSP ownership:

- Electron main persists global definitions and resolves per-session selections.
- The sidecar starts the selected LSP server processes for a run, initializes them with the active project root, and exposes a focused tool surface through `AIFunction`s.
- The renderer only consumes typed config and per-session enablement state.

Why this shipped path fits v1:

- it keeps LSP capabilities closest to the agent tool runtime
- it avoids building a second transport bridge between Electron main and the sidecar before the tool surface is proven
- it preserves the user-facing model of "enable a tool for this session and let the agent use it"

### 6. Prefer one user-facing tooling model

The long-term product should not feel like "MCP over here, raw LSP over there" from a UX perspective.

Recommended path:

- implement direct MCP runtime support first
- implement LSP as a backend capability service second
- where feasible, expose LSP-backed actions to agents through MCP-like or tool-like abstractions instead of teaching the system two unrelated tool invocation models

## Proposed data models

The exact names can change, but the structure should follow these boundaries.

### MCP definitions

```ts
interface McpServerDefinition {
  id: string;
  name: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: McpEnvironmentBinding[];
  cwdStrategy?: 'project-root' | 'custom';
  customCwd?: string;
  enabled?: boolean;
}

interface McpEnvironmentBinding {
  key: string;
  valueSource: 'literal' | 'secret-ref';
  value?: string;
  secretRef?: string;
}
```

### LSP profiles

```ts
interface LspProfileDefinition {
  id: string;
  name: string;
  languageIds: string[];
  transport: 'stdio';
  command: string;
  args?: string[];
  initialization?: {
    rootStrategy: 'project-root' | 'workspace-roots';
    initializationOptions?: Record<string, unknown>;
  };
  enabled?: boolean;
}
```

### Runtime diagnostics

```ts
interface ToolingHealthSummary {
  status: 'ready' | 'warning' | 'error' | 'disabled';
  summary: string;
  detail?: string;
  checkedAt: string;
}
```

Use separate summaries for:

- workspace MCP health
- current session MCP enablement health
- LSP profile health
- current session LSP enablement health

## Backend execution plan

Backend must be executed first.

### B0. Domain and persistence foundation

Primary files:

- `src/shared/domain/workspace.ts`
- `src/shared/domain/session.ts`
- `src/main/persistence/workspaceRepository.ts`
- `tests/shared/workspace.test.ts`
- `tests/shared/session.test.ts`

Tasks:

- add optional workspace-level tooling settings
- add optional session-level tooling enablement
- keep persisted migration additive and backward compatible
- ensure legacy workspaces load without mutation errors
- do not persist any secret values

Acceptance:

- old workspaces still load
- new fields round-trip through persistence
- tests cover legacy and new shapes

### B1. Main-process tooling services and IPC

Primary files:

- `src/main/EryxAppService.ts`
- `src/shared/contracts/ipc.ts`
- `src/shared/contracts/channels.ts`
- `src/main/ipc/registerIpcHandlers.ts`
- `src/preload/index.ts`

Recommended additions:

- CRUD for MCP server definitions
- CRUD for LSP profiles
- session enable/disable methods for both systems
- diagnostics/status methods
- secret-reference save/delete flows that route through `SecretStore`

Acceptance:

- renderer gets a typed, renderer-safe API
- all config changes persist through `WorkspaceRepository`
- diagnostics can be queried without starting a session
- session enablement can be updated without mutating global definitions

### B2. Sidecar protocol expansion for MCP

Primary files:

- `src/shared/contracts/sidecar.ts`
- `sidecar/src/Eryx.AgentHost/Contracts/ProtocolModels.cs`
- `sidecar/src/Eryx.AgentHost/Services/SidecarProtocolHost.cs`
- `src/main/sidecar/sidecarProcess.ts`
- `sidecar/tests/Eryx.AgentHost.Tests/SidecarProtocolHostTests.cs`

Tasks:

- extend capabilities with MCP availability/diagnostics
- extend `run-turn` with selected MCP runtime bindings
- optionally add dedicated MCP health validation commands if needed
- keep the protocol additive to avoid breaking existing clients

Acceptance:

- TS and C# contracts remain in sync
- protocol tests cover the new shapes
- existing capabilities and run-turn behavior still work without MCP config

### B3. MCP runtime attachment in the sidecar

Primary files:

- `sidecar/src/Eryx.AgentHost/Services/CopilotWorkflowRunner.cs`
- new helper services under `sidecar/src/Eryx.AgentHost/Services/`
- `sidecar/tests/Eryx.AgentHost.Tests/CopilotWorkflowRunnerTests.cs`

Tasks:

- translate main-process MCP definitions into runtime-attached tools
- attach tools during `SessionConfig` creation
- handle startup failures and unsupported transports cleanly
- emit richer activity when tool/server identity matters
- revisit the current blanket `ApprovePermissionAsync(...)` behavior before enabling arbitrary external tools

Acceptance:

- project-backed runs can invoke enabled MCP tools
- tool failures surface clearly to the app
- scratchpad behavior remains intentionally restricted unless product scope changes

### B4. LSP tool sessions in the sidecar

Primary files:

- `sidecar/src/Eryx.AgentHost/Services/LspToolSession.cs`
- `sidecar/src/Eryx.AgentHost/Services/SessionToolingBundle.cs`
- `package.json`
- `sidecar/tests/Eryx.AgentHost.Tests/*`

Tasks:

- start selected LSP server processes inside the sidecar for the active run
- initialize them against the current session project root
- expose a focused read-oriented tool surface to agents
- keep lifecycle cleanup bound to the run/session bundle
- start with TypeScript-first support

Acceptance:

- a project-backed session can initialize at least one supported LSP profile
- agents can call the exposed LSP tools without any renderer-managed process lifecycle
- no raw LSP JSON-RPC is exposed to the renderer

### B5. LSP bridge into agent runtime

Primary files:

- `src/main/EryxAppService.ts`
- `src/shared/contracts/sidecar.ts`
- `sidecar/src/Eryx.AgentHost/Contracts/ProtocolModels.cs`
- `sidecar/src/Eryx.AgentHost/Services/SessionToolingBundle.cs`
- `sidecar/src/Eryx.AgentHost/Services/LspToolSession.cs`

Tasks:

- compose selected LSP profiles into the `run-turn` payload from Electron main
- translate those profiles into sidecar-local tool sessions
- expose a stable subset of LSP-backed operations to agents
- avoid turning the renderer into a second IDE protocol stack

Recommended direction:

- use sidecar-local `AIFunction` tools for agent consumption
- keep the exposed operations narrow and project-oriented

Acceptance:

- agents can request useful LSP-backed project intelligence during project runs
- the contract is observable and testable from the app side

### B6. Backend hardening and validation

Primary files:

- impacted TS and C# tests
- `package.json`

Validation commands:

- `bun test`
- `bun run sidecar:test`
- `bun run build`

Hardening checklist:

- additive migration coverage
- bad configuration/error reporting coverage
- environment sanitization review for spawned tools/servers
- sidecar protocol regression coverage

## Frontend execution plan

Frontend should start only after backend APIs and diagnostics are stable.

### F1. Read-only diagnostics surfaces

Primary files:

- `src/renderer/App.tsx`
- `src/renderer/components/SettingsPanel.tsx`
- `src/renderer/components/CopilotStatusCard.tsx`

Tasks:

- add MCP and LSP sections in settings
- surface backend-reported health, readiness, and counts
- reuse the current diagnostics-card style before introducing complex editors

Acceptance:

- users can see whether MCP/LSP are configured and healthy
- failures are understandable without opening logs

### F2. Global configuration editors

Primary files:

- `src/renderer/components/SettingsPanel.tsx`
- new renderer components for MCP/LSP editors
- `src/renderer/App.tsx`

Tasks:

- create/edit/delete MCP server definitions
- create/edit/delete LSP profiles
- manage secret references safely
- do not mix global definition editing with per-session toggles
- allow secret references without ever echoing raw secrets back into the renderer state

Acceptance:

- all backend CRUD flows are reachable through the UI
- global definitions are understandable and recoverable

### F3. Session tooling panel controls

Primary files:

- `src/renderer/components/ActivityPanel.tsx`
- `src/renderer/App.tsx`
- supporting renderer state/helpers

Tasks:

- extend the current right-side activity panel with MCP/LSP enable/disable controls for the selected session
- show which global tools are available vs enabled for the session
- disable LSP/MCP controls when the selected session cannot use them, such as scratchpad if that restriction remains
- surface lightweight health/state next to each toggle

Acceptance:

- users can enable or disable global MCPs/LSPs per session from the right-side panel
- session toggles are persisted on the session record and survive app reloads

### F4. Runtime visibility in chat/activity surfaces

Primary files:

- `src/renderer/components/ActivityPanel.tsx`
- `src/renderer/lib/sessionActivity.ts`
- `src/shared/domain/event.ts`
- possibly `src/renderer/components/ChatPane.tsx`

Tasks:

- show tool server name + tool name clearly
- distinguish MCP activity from LSP-backed activity if both appear
- show meaningful failure summaries
- leave room for a future richer timeline without blocking this phase

Acceptance:

- users can tell what tool/server was used during a run
- failures do not collapse into generic "tool-calling" noise

### F5. Session-level polish and troubleshooting UX

Primary files:

- `src/renderer/components/ActivityPanel.tsx`
- `src/renderer/components/ChatPane.tsx`
- any supporting session detail surfaces

Tasks:

- show current session tooling status clearly
- add "why unavailable?" and "fix configuration" entry points
- optionally add compact badges or chips for active MCP/LSP selections

Acceptance:

- session-scoped tooling is visible without leaving the main workflow
- troubleshooting paths are discoverable

## Handoff between backend and frontend agents

### Backend agent handoff deliverables

The backend pass should hand off:

- finalized shared domain shapes
- finalized IPC contract
- finalized sidecar contract changes
- clear diagnostics payloads
- scratchpad/tool policy behavior
- finalized session enablement state shape
- test coverage for persistence, protocol, and runtime behavior

### Frontend agent prerequisites

The frontend agent should not start until it has:

- stable backend CRUD endpoints
- stable health/diagnostic payloads
- stable activity event shapes
- at least one working MCP path and one working LSP profile path to design against
- stable session enable/disable semantics for the right-side panel

## Risks and decisions to settle early

### A. Define what "LSP support" means in v1

This is the biggest scope decision. Options include:

- agent-facing project intelligence only
- agent-facing intelligence plus light read-only diagnostics in the UI
- a much larger editor-like in-app LSP experience

Recommended default:

- agent-facing project intelligence first
- diagnostics UI second
- editor-like UX later

### B. Decide the scratchpad policy

Current behavior is strongly tool-free. Keep that default unless product scope explicitly changes.

### C. Decide the default session behavior

Need to decide whether new sessions start with:

- no MCPs/LSPs enabled by default
- a safe recommended subset enabled by default
- the same enablement as the previously selected session

Recommended default:

- start disabled by default until a session explicitly enables a tool

### D. Decide provisioning and trust

Need explicit decisions for:

- bundled vs user-installed MCP/LSP servers
- which transports are allowed in v1
- whether arbitrary commands are allowed
- whether write-capable tools need approval
- whether LSP starts TypeScript-only first

### E. Decide the approval/safety model

`ApprovePermissionAsync(...)` currently auto-approves. That is not a sufficient trust model for arbitrary MCP tooling. A v1 safety story is needed before enabling broad external tool execution.

### F. Decide observability depth

Current activity events are coarse. MCP/LSP may require richer activity or trace events to stay understandable.

## Recommended sequencing summary

1. B0: persisted vocabulary and migration-safe shapes
2. B1: main-process API and diagnostics
3. B2: sidecar protocol expansion
4. B3: MCP runtime support
5. B4: Electron-main LSP service
6. B5: LSP bridge into agent runtime
7. F1-F5: frontend diagnostics, global editors, session toggles, visibility, and polish

## Out of scope for the first implementation pass

- a full IDE/editor inside Eryx
- raw LSP transport in the renderer
- persisted secret values in workspace files
- broad packaging/install automation for every possible LSP/MCP ecosystem on day one

## Suggested validation gate before frontend begins

Before handing to the frontend agent, the backend agent should be able to demonstrate:

- additive workspace persistence for MCP/LSP config
- at least one working MCP-backed agent flow in a project session
- one initialized, health-reporting LSP profile in Electron main
- per-session enable/disable persistence for selected MCPs/LSPs
- stable diagnostics payloads exposed to the renderer
- passing `bun test`, `bun run sidecar:test`, and `bun run build`
