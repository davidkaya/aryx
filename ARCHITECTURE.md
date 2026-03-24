# Architecture

## Overview

Eryx is a desktop Electron application for Copilot-powered work across a scratchpad and project-backed sessions. The codebase is intentionally split into five major layers:

- an Electron **main process** that owns native integration, persistence, git inspection, and sidecar lifecycle
- a React **renderer** that owns the user interface
- a **preload bridge** that exposes a typed IPC API to the renderer under context isolation
- a shared TypeScript **domain/contracts** layer used on both sides of the Electron boundary
- a .NET **sidecar** process that talks to GitHub Copilot and Microsoft Agent Framework over stdio

This split keeps the UI process unprivileged while concentrating filesystem, process, and workflow orchestration in the main process and sidecar.

Key entry points:

- `src/main/index.ts:11-42`
- `src/main/windows/createMainWindow.ts:6-46`
- `src/preload/index.ts:6-50`
- `src/renderer/App.tsx:83-153`
- `sidecar/src/Eryx.AgentHost/Program.cs:1-10`

## High-level runtime topology

```text
Renderer (React + Tailwind)
  |
  | window.eryxApi
  v
Preload bridge
  |
  | ipcRenderer.invoke / ipcMain.handle
  v
Electron main process
  - EryxAppService
  - WorkspaceRepository
  - GitService
  - SidecarClient
  |
  | JSON lines over stdio
  v
.NET sidecar (Eryx.AgentHost)
  - SidecarProtocolHost
  - CopilotWorkflowRunner
  |
  v
GitHub Copilot CLI + Microsoft Agent Framework
```

## Source layout

### Main process

- `src/main/index.ts` boots the app, creates the main window, registers IPC handlers, and applies the persisted title-bar theme (`src/main/index.ts:11-24`).
- `src/main/windows/createMainWindow.ts` creates the `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, a hidden native title bar, and an Electron title bar overlay (`src/main/windows/createMainWindow.ts:9-30`).
- `src/main/ipc/registerIpcHandlers.ts` maps renderer IPC calls onto `EryxAppService` methods and forwards service events back to the renderer (`src/main/ipc/registerIpcHandlers.ts:24-97`).
- `src/main/EryxAppService.ts` is the main application service. It owns workspace mutation, session lifecycle, tool selection, sidecar orchestration, and event emission (`src/main/EryxAppService.ts:82-117`, `src/main/EryxAppService.ts:317-474`, `src/main/EryxAppService.ts:837-943`).
- `src/main/persistence/` contains JSON-backed workspace persistence and app-specific paths (`src/main/persistence/appPaths.ts:4-10`, `src/main/persistence/jsonStore.ts:4-20`, `src/main/persistence/workspaceRepository.ts:38-86`).
- `src/main/git/gitService.ts` derives repository status, branch, upstream, ahead/behind counts, dirty state, and latest commit metadata for attached projects (`src/main/git/gitService.ts:172-250`).
- `src/main/sidecar/` resolves, spawns, and communicates with the .NET sidecar while sanitizing the child-process environment (`src/main/sidecar/sidecarProcess.ts:35-232`, `src/main/sidecar/sidecarRuntime.ts:24-48`, `src/main/sidecar/sidecarEnvironment.ts:1-17`).

### Renderer

- `src/renderer/App.tsx` is the top-level React composition root. It loads workspace state and sidecar capabilities, subscribes to workspace/session events, applies the theme, and composes `Sidebar`, `ChatPane`, `ActivityPanel`, `WelcomePane`, `SettingsPanel`, and `NewSessionModal` (`src/renderer/App.tsx:83-153`, `src/renderer/App.tsx:240-390`).
- The UI is built from focused components under `src/renderer/components/`, with the right-side `ActivityPanel` exposing per-agent activity, run timeline, and per-session tooling toggles (`src/renderer/components/ActivityPanel.tsx:158-311`).
- `src/renderer/lib/sessionActivity.ts` maintains ephemeral activity state keyed by session, separate from persisted workspace JSON (`src/renderer/lib/sessionActivity.ts:20-143`).
- `src/renderer/styles.css` defines the global visual tokens and light/dark theme switching via CSS custom properties (`src/renderer/styles.css:1-80`).

### Shared domain and contracts

- `src/shared/domain/workspace.ts` defines the persisted workspace aggregate (`src/shared/domain/workspace.ts:8-28`).
- `src/shared/domain/project.ts` defines project records and guarantees a synthetic scratchpad project with a stable ID (`src/shared/domain/project.ts:34-76`).
- `src/shared/domain/session.ts` defines session records, scratchpad-specific config, and session-title resolution (`src/shared/domain/session.ts:27-114`).
- `src/shared/domain/pattern.ts` defines orchestration patterns and seeds built-in modes such as `single`, `sequential`, `concurrent`, `handoff`, `group-chat`, and a reserved `magentic` mode (`src/shared/domain/pattern.ts:62-253`).
- `src/shared/domain/tooling.ts` defines global tooling settings, per-session tooling selection, and persisted appearance theme settings (`src/shared/domain/tooling.ts:38-95`).
- `src/shared/domain/runTimeline.ts` defines persisted per-run history and the event model used to render execution timelines (`src/shared/domain/runTimeline.ts:222-454`).
- `src/shared/contracts/ipc.ts` defines the typed renderer API exposed through preload (`src/shared/contracts/ipc.ts:14-99`).
- `src/shared/contracts/sidecar.ts` defines the stdio protocol between Electron and the sidecar, including commands, streamed delta events, activity events, and tooling payloads (`src/shared/contracts/sidecar.ts:4-178`).

### Sidecar

- `sidecar/src/Eryx.AgentHost/Program.cs` is the .NET entrypoint and requires `--stdio` (`sidecar/src/Eryx.AgentHost/Program.cs:1-10`).
- `sidecar/src/Eryx.AgentHost/Services/SidecarProtocolHost.cs` implements the line-delimited JSON protocol. It handles `describe-capabilities`, `validate-pattern`, and `run-turn`, and serializes success/error events back to Electron (`sidecar/src/Eryx.AgentHost/Services/SidecarProtocolHost.cs:24-175`).
- `sidecar/src/Eryx.AgentHost/Services/CopilotWorkflowRunner.cs` validates patterns, builds a workflow from the incoming pattern, streams message deltas and agent activity, and returns completed assistant messages (`sidecar/src/Eryx.AgentHost/Services/CopilotWorkflowRunner.cs:31-170`).

## Main process architecture

`EryxAppService` is the central application service and the main process entry point for business logic. It owns:

- workspace loading and caching (`src/main/EryxAppService.ts:99-112`)
- project addition and git-context refresh scheduling (`src/main/EryxAppService.ts:104-109`, `src/main/EryxAppService.ts:119-170`, `src/main/EryxAppService.ts:569-581`)
- pattern, settings, and tooling mutations (`src/main/EryxAppService.ts:198-314`, `src/main/EryxAppService.ts:477-562`)
- session creation, duplication, selection, pin/archive state, and title updates (`src/main/EryxAppService.ts:317-382`, `src/main/EryxAppService.ts:584-601`)
- run execution and streamed sidecar integration (`src/main/EryxAppService.ts:385-474`)
- persistence and UI fan-out through `workspace-updated` and `session-event` emissions (`src/main/EryxAppService.ts:837-840`)

This is the main "application boundary" inside Electron: IPC is intentionally thin, and the service concentrates cross-cutting logic instead of scattering it across handlers or renderer components.

## Persistence model

Persistent application state is stored as a single JSON document:

- workspace file path: `app.getPath('userData')/workspace.json` (`src/main/persistence/appPaths.ts:4-6`)
- scratchpad directory path: `app.getPath('userData')/scratchpad` (`src/main/persistence/appPaths.ts:8-10`)

`WorkspaceRepository.load()` normalizes and repairs persisted state on every load:

- creates the scratchpad directory if needed
- seeds the workspace if no JSON exists yet
- ensures the scratchpad project is always present
- re-merges built-in patterns so shipped defaults stay current
- normalizes run records, session tooling, and workspace settings
- writes the normalized result back to disk (`src/main/persistence/workspaceRepository.ts:42-77`)

There is no separate database. The workspace JSON is the durable source of truth for projects, sessions, patterns, settings, and run history.

## Session and workflow model

### Projects

Projects are either:

- the synthetic scratchpad project with ID `project-scratchpad`
- user-added folders with optional git metadata (`src/shared/domain/project.ts:34-76`)

The scratchpad is treated as a first-class project so the UI can share the same session model across scratchpad and project-backed work.

### Patterns

Patterns describe how agents collaborate. Built-in modes currently include:

- `single`
- `sequential`
- `concurrent`
- `handoff`
- `group-chat`
- `magentic` (reserved/unavailable in the current .NET runtime) (`src/shared/domain/pattern.ts:62-253`)

Patterns are shared data, not renderer-only configuration, which lets the same definition drive UI, validation, persistence, and sidecar execution.

### Sessions

A `SessionRecord` stores:

- the selected project and pattern
- messages and status
- optional scratchpad model overrides
- per-session tool selection
- persisted run history (`src/shared/domain/session.ts:27-43`)

Scratchpad sessions can override the primary agent model and reasoning effort, but they cannot enable MCP or LSP tools (`src/main/EryxAppService.ts:477-510`, `src/main/EryxAppService.ts:513-561`).

### Run timeline

Every user turn creates a persisted run record before execution starts. That record captures:

- the triggering user message
- pattern mode and participating agents
- timestamped events such as thinking, tool calls, handoffs, message progress, completion, and failure (`src/shared/domain/runTimeline.ts:222-454`)

This allows the UI to show both an activity summary and a historical run timeline instead of only rendering the final assistant text.

## Renderer architecture

`App.tsx` is the renderer root and behaves like a thin stateful shell around the shared domain model:

- loads workspace state and sidecar capabilities on mount (`src/renderer/App.tsx:94-109`)
- subscribes to `workspace-updated` and `session-event` streams (`src/renderer/App.tsx:111-132`)
- applies the effective theme to the document root (`src/renderer/App.tsx:134-153`)
- routes the current state into the main surfaces:
  - `Sidebar` for projects/sessions
  - `ChatPane` for the active conversation
  - `ActivityPanel` for run activity and tooling
  - `WelcomePane` when no session is selected
  - `SettingsPanel` and `NewSessionModal` as overlays (`src/renderer/App.tsx:240-390`)

The renderer does not own persistence. It reacts to snapshots from the main process and sends intents back through the typed preload API.

## IPC boundary

The Electron boundary is intentionally explicit:

- `createMainWindow()` enables `contextIsolation` and disables `nodeIntegration` (`src/main/windows/createMainWindow.ts:26-30`)
- the preload script exposes a limited `window.eryxApi` surface (`src/preload/index.ts:6-50`)
- the contract for that surface lives in `src/shared/contracts/ipc.ts:14-99`
- the main process handles those calls in `src/main/ipc/registerIpcHandlers.ts:24-97`

That keeps the renderer decoupled from Electron internals and makes IPC shape changes visible in one shared contract file.

## Sidecar integration

The main process talks to the sidecar through `SidecarClient`:

- it resolves the runtime differently for dev and packaged modes (`src/main/sidecar/sidecarRuntime.ts:24-48`)
- it spawns the sidecar with a sanitized environment that strips Bun, Copilot, Electron, Node, and npm-prefixed variables (`src/main/sidecar/sidecarEnvironment.ts:1-17`)
- it sends JSON commands and reads newline-delimited JSON events from stdout (`src/main/sidecar/sidecarProcess.ts:117-232`)

The sidecar protocol supports three command types:

- `describe-capabilities`
- `validate-pattern`
- `run-turn` (`src/shared/contracts/sidecar.ts:57-79`)

For `run-turn`, the sidecar streams:

- `turn-delta` events for partial assistant text
- `agent-activity` events for thinking, tool calls, and handoffs
- `turn-complete` when the turn is finished (`src/shared/contracts/sidecar.ts:129-178`)

`EryxAppService.sendSessionMessage()` is the integration point that turns a user message into a run:

1. append the user message to the session
2. mark the session as running
3. create a run record
4. persist and broadcast the updated workspace
5. invoke `sidecar.runTurn(...)`
6. apply streamed deltas and activity events as they arrive
7. finalize or fail the run and persist again (`src/main/EryxAppService.ts:385-474`)

## Tooling model

Tooling is split into two levels:

- **global definitions** in workspace settings for MCP servers and LSP profiles (`src/shared/domain/tooling.ts:38-48`)
- **per-session enablement** through selected MCP/LSP IDs (`src/shared/domain/tooling.ts:50-95`)

The renderer exposes those toggles in the `ActivityPanel`, but the main process is responsible for validating selections and resolving them into concrete `run-turn` tooling payloads (`src/renderer/components/ActivityPanel.tsx:249-305`, `src/main/EryxAppService.ts:865-943`).

This gives the app reusable machine-wide tooling definitions while preserving session-level control over which tools are active.

## Theme and window chrome

Theme is persisted in workspace settings as `dark`, `light`, or `system` (`src/shared/domain/tooling.ts:43-86`).

Theme application is split across processes:

- the renderer sets `data-theme` on the document root and follows OS preference changes for the `system` option (`src/renderer/App.tsx:134-153`)
- `src/renderer/styles.css` remaps semantic and Tailwind-backed color tokens for light mode (`src/renderer/styles.css:1-80`)
- the main process updates Electron's title bar overlay colors so native window controls stay visually aligned (`src/main/windows/titleBarTheme.ts:20-38`, `src/main/ipc/registerIpcHandlers.ts:38-42`)

## Activity and git context

Two pieces of operational state complement the core chat history:

- **agent activity**, which is ephemeral renderer-side state derived from streamed session events (`src/renderer/lib/sessionActivity.ts:20-143`)
- **project git context**, which is durable project metadata refreshed from the local git CLI (`src/main/git/gitService.ts:172-250`, `src/main/EryxAppService.ts:569-581`)

This combination lets Eryx show both live execution status and repository awareness without overloading the chat transcript itself.

## Build, test, package, and release architecture

### Local scripts

The repository uses Bun as the task runner (`package.json:7-19`):

- `bun run test` runs TypeScript type-checking and Bun tests
- `bun run sidecar:test` runs .NET sidecar tests
- `bun run build` builds the Electron app and the .NET sidecar
- `bun run package` builds the current platform release bundle

### Packaging

Packaging is script-driven rather than delegated to a generic Electron packager:

- `scripts/releaseTarget.ts` resolves platform- and arch-specific release metadata (`scripts/releaseTarget.ts:7-84`)
- `scripts/publish-sidecar.ts` publishes a self-contained .NET sidecar for the current runtime identifier (`scripts/publish-sidecar.ts:32-65`)
- `scripts/package-electron.ts` assembles the release directory by copying Electron runtime files, built renderer/main assets, runtime dependencies, and the published sidecar, then applies platform-specific metadata like icons and bundle names (`scripts/package-electron.ts:33-240`)

### CI and releases

`.github/workflows/release.yml` defines the pipeline:

- validate on push and pull request across Windows, macOS, and Linux
- create a GitHub release on tag pushes
- package each platform in parallel and upload the archives directly to the release (`.github/workflows/release.yml:15-154`)

## Architectural principles in practice

The current codebase consistently leans on a few patterns:

- keep renderer code focused on presentation and user intent
- keep persistence and mutation logic in the main process service layer
- use shared domain/contracts as the canonical model across boundaries
- isolate Copilot and orchestration runtime concerns in the sidecar
- make session execution observable through streamed events and persisted run history

When adding features, prefer extending those boundaries rather than bypassing them.
