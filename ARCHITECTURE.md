# Architecture

## What this system is

Aryx is a desktop workspace for Copilot-powered development work. It combines a persistent session model, project-aware context, reusable workflow orchestration, optional external tooling, and live run visibility inside a single Electron application.

At a high level, the architecture is built around one core idea:

> keep the UI safe and responsive, keep application state centralized, and keep AI execution isolated in its own runtime.

That produces a system with clear boundaries:

- the **renderer** owns presentation and user interaction
- the **Electron main process** owns state mutation, persistence, OS integration, and process management
- the **sidecar** owns Copilot-backed execution and orchestration
- **shared contracts and domain models** keep all boundaries typed and explicit

## Design goals

The current architecture optimizes for:

- **safe desktop boundaries** between UI code and privileged capabilities
- **persistent workspaces** rather than disposable chat threads
- **project-aware execution** with repository context and optional tooling
- **observable AI runs** with streamed output, activity, and history
- **extensible orchestration** so workflows, models, and tool integrations can evolve without collapsing boundaries

## System context

```mermaid
flowchart LR
    User[User]
    Renderer[Renderer UI<br/>React + Tailwind]
    Preload[Preload bridge]
    Main[Electron main process]
    Workspace[Workspace storage<br/>workspace.json + per-session scratchpad directories]
    Git[Local git repositories]
    Sidecar[.NET sidecar]
    Copilot[GitHub Copilot CLI<br/>+ agent runtime]
    OS[Native windowing<br/>and desktop integration]

    User --> Renderer
    Renderer <--> Preload
    Preload <--> Main
    Main <--> Workspace
    Main <--> Git
    Main <--> Sidecar
    Sidecar <--> Copilot
    Main <--> OS
```

## Runtime boundaries

| Boundary | Owns | Does not own | Communicates through |
| --- | --- | --- | --- |
| Renderer | Screens, interaction, local view composition, theme application | Filesystem, process spawning, raw Electron access, Copilot runtime | Typed preload API and pushed events |
| Preload | Narrow bridge between browser context and Electron IPC | Business logic, persistence, orchestration | `ipcRenderer` / `ipcMain` |
| Main process | Workspace mutation, persistence, git inspection/write operations, run change attribution, commit workflow orchestration, session lifecycle, native window state, sidecar lifecycle, PTY-backed terminal lifecycle | UI rendering, LLM orchestration internals | IPC, filesystem, git CLI, stdio with sidecar, native child processes |
| Sidecar | Capability discovery, workflow validation, run execution, streaming deltas and activity | UI, workspace persistence, Electron APIs | Line-delimited JSON over stdio |
| External systems | Git data, Copilot account/model access, OS window chrome | Application state and UI behavior | Controlled adapters owned by main or sidecar |

This split is the most important architectural feature in the app. It is what keeps the system understandable as more capabilities are added.

## High-level runtime model

Aryx runs as a multi-process desktop application:

1. The **renderer** displays the workspace and captures user intent.
2. The **preload bridge** exposes a small, typed API into the browser context.
3. The **main process** validates and mutates application state, persists it, and manages native integrations.
4. The **sidecar** executes Copilot-backed turns and streams structured execution events back.

The sidecar is intentionally separate from the Electron main process so that AI runtime concerns stay isolated from UI and persistence concerns.

## Main user flow

The most important end-to-end interaction is sending a message in a session.

```mermaid
sequenceDiagram
    participant U as User
    participant R as Renderer
    participant P as Preload
    participant M as Main process
    participant S as Sidecar
    participant C as Copilot runtime

    U->>R: Send message
    R->>P: Invoke typed API
    P->>M: IPC request
    M->>M: Append user message
    M->>M: Capture pre-run git snapshot, create run record, and mark session running
    M->>S: run-turn command
    S->>C: Execute workflow
    C-->>S: Partial output / tool activity / handoffs / input requests
    S-->>M: Stream deltas and activity events
    M-->>R: Push session events and workspace updates
    C-->>S: Final messages or turn boundary
    S-->>M: Completion or error
    M->>M: Finalize run, compute post-run git summary, refresh project git state, and persist state
    M-->>R: Final workspace snapshot
```

This flow is important because it shows that Aryx is not architected as a simple "send prompt, get string" application. It treats execution as a structured, observable process.

## Application state model

The durable state of the app is a **workspace**. The workspace contains:

- connected projects
- workflows
- workflow templates
- sessions
- settings
- run history

This gives Aryx a persistent operating model rather than a transient chat model.

### Projects

Projects are the container for context. There are two kinds:

- a special **scratchpad** project for lightweight work
- normal **project-backed** entries pointing at local folders

The scratchpad is modeled inside the same workspace system instead of as a separate subsystem. That keeps the UI and session model consistent while still allowing special rules for scratchpad behavior. Each scratchpad session receives its own working directory under the shared scratchpad root, so session-created files stay isolated from other scratchpad conversations.

Project-backed entries also persist scanned Copilot customization metadata discovered from repository files such as `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, recursive `.github/instructions/**/*.instructions.md`, recursive `.claude/rules/**/*.md`, recursive `.github/agents/**/*.agent.md`, and recursive `.github/prompts/**/*.prompt.md`. The main process owns that scan step, walks parent directories up to the nearest `.git` root so nested workspace folders inherit repository-level customizations, strips Markdown front matter where supported, expands relative Markdown links into referenced file context, classifies instruction files by application mode (`always`, `file`, `task`, `manual`), and stores the normalized results on the project record so repo instructions and enabled custom agent profiles can participate in later run execution without turning the renderer into a filesystem crawler. It also maintains lightweight filesystem watches over each discovered customization root plus existing `.github/` and `.claude/` subdirectories so customization changes can trigger debounced rescans and renderer updates without manual refreshes.

For git-backed projects, the main process also owns background git refreshes, captures a structured pre-run working-tree snapshot on each run record, and persists a post-run git change summary after project-backed turns complete. It also owns all git write operations exposed by Aryx — selective discard, staging, commit, push/pull/fetch, and branch lifecycle actions — so the renderer never shells out directly or manipulates repository state on its own.

### Workflows

Workflows describe how agents collaborate. The architecture supports:

- one-agent conversations
- sequential execution
- concurrent fan-out / fan-in flows
- handoff-style routing
- group-chat style collaboration

Their runtime semantics follow the Agent Framework orchestration model: sequential and group chat preserve a visible shared conversation, concurrent aggregates multiple independent responses into one turn, and handoff turns can end once the active agent has responded and is waiting for the next user input.

For Copilot-backed agents, Aryx uses a repo-local adapter around the Copilot SDK session layer so workflow agent routes still behave like Agent Framework handoffs. This is necessary because the upstream `GitHubCopilotAgent` does not currently project run-time handoff tool declarations into Copilot sessions or surface Copilot tool requests back as `FunctionCallContent` for the workflow runtime.

Workflows are shared application data, not renderer-only configuration. The same workflow definition now drives validation, persistence, session execution, and sidecar orchestration.

Each workflow persists an explicit graph-backed topology. Agent nodes carry stable ids, ordering, and layout metadata, while start/end, fan-out/fan-in, sub-workflow, function, and request-port nodes make execution structure visible in the saved contract.

That graph remains the execution contract for the sidecar, but orchestration mode is now a first-class backend concept. Graph-based modes (`single`, `sequential`, `concurrent`) still execute directly from saved edges. Builder-based modes (`handoff`, `group-chat`) additionally persist mode-specific `settings.modeSettings` data for handoff filtering, triage selection, return behavior, and group-chat round limits, and the sidecar translates those settings into specialized Agent Framework workflow builders at run time.

Workflow templates remain a first-class shared-domain contract. The shared layer owns workflow definitions, workflow template definitions, and workflow import/export helpers (YAML import/export plus Mermaid and DOT export). Built-in workflows seed workspace state directly, while built-in and custom templates let the main process create additional saved workflows without expanding the sidecar protocol.

### Sessions

A session is the working unit of the product. It binds together:

- a project
- a workflow
- a message history
- status and errors
- optional per-session tool selection
- persisted run history

This is how Aryx keeps "ongoing work" first class. Sessions can survive restarts, can be organized, and can accumulate operational history over time.

Individual messages can be pinned as bookmarks. A dedicated bookmarks panel (`BookmarksPanel`) lists all pinned messages across all sessions globally, navigating to the originating session and message on selection. This data is derived renderer-side from the workspace state; there is no separate backend API.

### Runs

Each user turn becomes a **run**. A run is more than the final assistant output; it also tracks:

- when execution started and ended
- which agents participated
- which activity happened during the turn
- partial streaming output
- success or failure
- optional git baselines and post-run change summaries for project-backed execution

That run model is what enables the activity panel and historical timeline instead of forcing the user to infer execution from message text alone.

## Communication model

Aryx uses two main communication links:

### 1. Renderer <-> main process

This is a typed IPC boundary used for user intent and workspace updates.

Typical examples:

- load workspace
- create session
- create a workflow from a template
- export or import a workflow definition
- send message
- update theme
- create or restart the integrated terminal
- toggle session tooling
- update session approval overrides

The renderer does not reach into Electron or the filesystem directly. It talks through a constrained API surface.

The integrated terminal uses the same boundary. The renderer never opens a shell directly; it asks the main process to create or restart a PTY, sends fire-and-forget input and resize messages over IPC, and listens for streamed terminal data and exit events pushed back through preload. The `TerminalPanel` component manages an xterm.js terminal instance with a FitAddon, a drag-to-resize handle, and a header bar showing shell status.

### 2. Main process <-> sidecar

This is a structured stdio protocol used for:

- capability discovery
- on-demand account quota lookup
- workflow validation
- run execution
- streaming partial output
- streaming agent activity

This protocol boundary keeps the AI execution runtime replaceable and prevents the Electron main process from becoming overloaded with workflow-specific behavior.

The protocol also carries **turn-scoped lifecycle events** alongside output deltas. These events let the UI visualize execution internals without the main process having to interpret AI workflow semantics:

- **Sub-agent events**: started, completed, failed, selected, deselected — surfaced when custom agents are defined
- **Skill invocation events**: emitted when an agent-side skill is triggered
- **Message reclassification events**: let the sidecar retroactively mark a streamed assistant message as `thinking` once the SDK confirms that message requested tool work, so the UI can separate intermediate planning chatter from the final response without sacrificing live streaming
- **Assistant intent and reasoning-delta events**: optional Copilot SDK metadata that exposes short "what I'm doing" labels plus incremental reasoning text for richer thinking-process surfaces
- **Hook lifecycle events**: start and end of configured project hook commands discovered from `.github/hooks/*.json`; Aryx suppresses the SDK's built-in no-op hook chatter so the UI only sees meaningful hook activity
- **Assistant usage events**: per-LLM-call tokens, cost, AIU, and quota snapshots from the Copilot SDK's `assistant.usage` stream
- **Session compaction events**: start and complete, with token-reduction metrics when infinite sessions trigger context trimming
- **Session usage events**: current token count and context-window limit from `session.usage_info` for context-bar rendering
- **Pending-messages-modified events**: emitted when mid-turn steering changes the pending message queue
- **Workflow diagnostic events**: normalized warnings and errors from Agent Framework (`WorkflowWarningEvent`, `WorkflowErrorEvent`, `ExecutorFailedEvent`) with optional executor or subworkflow metadata for richer debugging surfaces
- **Workflow checkpoint events**: emitted at Agent Framework superstep boundaries with workflow session ID, checkpoint ID, step number, and checkpoint-store path so the main process can prepare crash-recovery state

These events flow through a single `onTurnScopedEvent` callback on the `runTurn` command, avoiding per-event-type callback proliferation. The main process maps each event to a `SessionEventRecord` and pushes it to the renderer, where lightweight state maps (activity, usage, turn-event log) consume them without touching the persisted workspace.

Tool-call activity records can also be enriched with a stable `toolCallId` and aggregated file-change preview payloads (`path`, unified diff, and optional new-file contents). The sidecar derives those previews from Copilot SDK write permission requests, and the main process merges repeated write events by `toolCallId` into the persisted run timeline so future UI surfaces can render file previews without reinterpreting approval payloads.

The same boundary also supports server-scoped sidecar commands that do not require a live Copilot session. The new `get-quota` command uses the SDK's `account.getQuota` RPC to fetch account quota snapshots on demand, then returns them as a `quota-result` protocol event followed by the usual `command-complete` sentinel.

For project-backed sessions, the sidecar also discovers GitHub Copilot CLI hook definitions from `.github/hooks/*.json` under the repository root. Those files are parsed and merged once per run bundle, then projected onto the SDK session hook delegates. Hook commands run synchronously in the sidecar through the platform shell, with stdin JSON payloads shaped to match Copilot CLI hook expectations as closely as the SDK allows. Hook failures are logged to stderr and treated as non-fatal diagnostics, while `preToolUse` hook outputs can still deny a tool call before Aryx falls back to its built-in approval policy.

The `run-turn` command now also carries a project-instruction payload derived from scanned repo customization files. The main process composes that payload from always-on repo instructions plus formatted file-scoped and task-scoped `.instructions.md` / `.claude/rules` entries, while omitting manual-only instruction files from automatic injection. It also merges enabled discovered custom agent profiles into the primary workflow agent's Copilot configuration before sending the command across the stdio boundary. Prompt-file submissions can additionally attach a structured `promptInvocation` payload with prompt identity, resolved prompt body, optional `agent`, optional `model`, and optional `tools` metadata. The main process stores that prompt invocation metadata on the triggering user message so replay and regenerate flows can rebuild it, hydrates missing metadata from the scanned prompt definition, promotes `agent: plan` to a per-turn plan-mode override, applies per-turn prompt model overrides to the effective workflow before execution, and falls back to a lightweight transcript message instead of pasting the full prompt body into chat history. The sidecar then folds both the project instructions and prompt invocation into the final SDK system message, uses prompt agent metadata to override `SessionConfig.Agent`, and narrows available tools for that turn when prompt `tools` metadata is present.

For handoff workflows, the sidecar now also enables Agent Framework JSON checkpointing backed by a per-turn filesystem store under local app data. Each saved checkpoint is surfaced to the main process, which pairs the durable Agent Framework checkpoint with an in-memory rollback snapshot of `session.messages` and the active run timeline events. If the sidecar child process exits unexpectedly during the same app lifetime, Aryx restores the latest snapshot, clears pending approval/user-input/MCP-auth state for that run, and retries the `run-turn` request once with `resumeFromCheckpoint`. Checkpoint directories are deleted after the turn completes, cancels, or fails. This recovery path is intentionally scoped to same-app sidecar restarts; full app-restart workflow rehydration would require durable rollback snapshots in addition to the Agent Framework checkpoint payloads.

## Security model

Security in this system is mostly about **desktop trust boundaries**.

### Renderer isolation

The renderer is treated as an unprivileged browser environment:

- Node integration is disabled
- context isolation is enabled
- privileged capabilities are only exposed through preload

That reduces accidental coupling and limits how much of the desktop environment UI code can touch directly.

### Narrow preload surface

The preload layer acts as a small gateway rather than a second application layer. It exposes only the operations the UI actually needs.

This keeps the bridge auditable and avoids leaking broad Electron capabilities into the renderer.

### Sidecar process isolation

Copilot execution lives in a separate process rather than inside the renderer or directly inside the UI layer of the main process.

That separation helps with:

- containment of runtime failures
- clearer ownership of AI workflow code
- cleaner protocol boundaries
- future evolution of the execution runtime

### Sanitized execution environment

When the main process launches the sidecar, it sanitizes the environment before passing control across the process boundary. This reduces leakage of host/runtime-specific variables into the AI execution environment.

### External link handling

Links opened from the renderer are handed off to the operating system instead of creating arbitrary in-app browser windows. This keeps external navigation outside the app's main trust boundary.

## Cross-cutting concerns

### Theme and window chrome

Theme is not only a renderer concern. It crosses both the web UI and native desktop shell:

- the renderer applies the selected appearance to the application surface
- the main process keeps native title-bar chrome aligned with the active theme

This is a good example of a cross-cutting concern that spans multiple layers without collapsing them together.

### Tooling integration

Tooling is deliberately split into two levels:

- **dynamic runtime tools** reported by the Copilot CLI, with a fallback catalog for startup/offline cases
- **global definitions** for MCP servers and LSP profiles
- **MCP tool discovery** — when MCP server configs declare wildcard tools (empty `tools` array), the main process probes each server directly via the MCP protocol `tools/list` method to discover available tools, using the same auth credentials Aryx manages for OAuth-protected servers
- **incremental probe progress** — MCP probing runs concurrently and publishes per-server progress through the pushed workspace snapshot, using the runtime-only `mcpProbingServerIds` field so the renderer can reflect in-flight discovery without persisting transient UI state
- **workflow defaults** where tool-call approval is enabled by default, plus which known runtime tools can bypass manual approval
- **per-session overrides** for both tool enablement and tool auto-approval

This lets the application treat tooling as reusable workspace capability while still preserving session-level control and safety.

### Project awareness

Project-backed sessions can carry repository context such as branch and dirty state, while scratchpad sessions omit git context but still support MCP, LSP, and runtime tooling. Scratchpad execution uses a per-session working directory instead of a single shared scratchpad folder, so file-based context and generated artifacts stay scoped to the active scratchpad session. Both session kinds share the same tooling selection and approval model. This keeps the architecture grounded in real codebases without forcing every conversation to be project-heavy, while still letting scratchpad sessions leverage configured tools when useful.

For git-backed projects, the renderer surfaces three specialized components. `RunChangeSummaryCard` appears inline in the run timeline after each completed run, showing the files changed during that run with per-file diff previews, origin attribution (run-created vs. pre-existing), and selective discard actions. `CommitComposer` is a slide-over panel for staging files, editing an AI-suggested commit message, selecting a conventional commit type, and committing (with optional push). `GitPanel` is embedded in the tabbed bottom panel (alongside the terminal) and provides branch management, push/pull/fetch network operations, working-tree change inspection, and recent commit history. The bottom panel uses a shared resize handle and tab bar so the terminal and git views coexist without competing for screen real estate. All git write operations flow through IPC to the main process; the renderer never runs git commands directly.

### Execution observability

The architecture treats execution as observable by design:

- partial output is streamed
- agent activity is surfaced
- turn-scoped lifecycle events (sub-agent, hook, skill, compaction, usage) are streamed
- runs are persisted as timeline history
- failures are represented explicitly

This improves trust and debuggability, especially for multi-agent workflows.

### Mid-turn steering

Aryx supports sending user messages while a turn is actively running. These messages are delivered with a `messageMode` flag (`immediate` or `enqueue`) that tells the sidecar to inject the content into the current Copilot session rather than starting a new turn. This enables real-time steering without waiting for turn completion. The main process allows the IPC call even when the session is in `running` status, and the renderer keeps the composer enabled throughout.

### Image attachments

User messages can carry image attachments as base64-encoded blobs. These flow from the renderer through IPC, the main process, and the sidecar protocol as `ChatMessageAttachmentDto` objects alongside the text content. The sidecar maps them into the Copilot SDK's `DataPart` model. Attachment metadata is persisted on the `ChatMessageRecord` so thumbnail previews render correctly when revisiting a session.

## Persistence and repair

Workspace persistence is intentionally simple: the app stores a durable workspace document and repairs or normalizes it when loading.

That gives the system:

- stable persisted state
- forward-compatible normalization
- a simple recovery model
- predictable behavior across restarts

## Desktop-native behavior

The main process owns desktop concerns such as:

- native window creation
- title bar behavior
- background process management
- filesystem access
- project folder selection

This keeps those concerns out of the renderer while still letting the UI feel native.

## Build and release architecture

Aryx ships as an Electron application bundled together with a self-contained .NET sidecar.

The build pipeline is organized around three layers:

- building the Electron renderer and main process assets
- publishing the sidecar for the target runtime
- packaging platform artifacts with electron-builder

electron-builder bundles the packaged Electron app, copies the published sidecar into `resources/sidecar`, produces Windows NSIS installers, macOS DMG + ZIP artifacts, and Linux AppImages, and uploads the release assets plus update metadata to GitHub Releases. Tagged macOS release jobs now materialize the certificate and App Store Connect key from repository secrets into temporary files on the runner, normalize the decoded PKCS#12 into a `security import`-compatible container, preflight that normalized certificate against a temporary keychain, export the standard `electron-builder` signing and notarization environment variables from those files, and package with checked-in hardened-runtime entitlements so native modules still run correctly under code signing. The main process consumes the published metadata through `electron-updater`, which checks GitHub Releases for packaged builds and can stage a restart-based update install.

Current Windows builds are unsigned, so the packaging config disables executable resource editing/signing and skips Windows update signature verification until a code-signing certificate is available. The packaging scripts also clear `release/` before each build so local packaging runs cannot accidentally mix stale artifacts with current ones.

This packaging model matches the runtime architecture: one desktop shell plus one dedicated AI execution process.

## Why this architecture works well

This architecture fits the product because it gives Aryx:

- a clear privilege split between UI and native capabilities
- a stable, persistent workspace model
- project-aware but optional repository grounding
- a sidecar that can evolve independently of the Electron shell
- room for richer orchestration without overloading the renderer
- visible execution state for user trust

In short, the system is architected as a **desktop control room for persistent AI-assisted work**, not as a thin chat wrapper around a model call.

## How to think about future changes

When extending the system, the safest mental model is:

- if it is **presentation or interaction**, it belongs in the renderer
- if it is **state mutation, persistence, desktop integration, or process management**, it belongs in the main process
- if it is **Copilot execution, orchestration, or streamed run behavior**, it belongs in the sidecar
- if it crosses boundaries, it should move through **shared contracts** rather than ad hoc coupling

Keeping those rules intact is what will let the codebase scale without losing clarity.
