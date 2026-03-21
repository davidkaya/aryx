# Kopaya Implementation Plan

This file mirrors the working plan in the Copilot session workspace so the repository also carries the current implementation direction.

## Problem statement

Build `kopaya` into an Electron desktop application for orchestrating AI agents across multiple local projects. The desktop app should use TypeScript on the frontend, use the .NET version of Microsoft Agent Framework (MAF) with Copilot SDK for orchestration/runtime work, support all MAF orchestration modes, and also support a simple Copilot-CLI-style 1-on-1 human/agent chat mode.

Users should be able to:

- open and manage multiple project folders
- define reusable orchestration patterns
- create sessions inside a selected project by choosing a pattern
- view and continue active/past sessions from a chat-first UI

The target UX is a left-side tree navigator for projects/sessions/patterns and a right-side main chat pane.

## Current repository state

- The repository is currently only a minimal Bun + TypeScript scaffold.
- `src/index.ts` is effectively empty.
- There is no Electron app structure yet.
- There is no renderer framework, no desktop state model, and no project/session UI.
- There is no .NET solution, no MAF integration, and no Copilot SDK integration yet.
- Current validation is minimal: `bun run test` maps to `bun run typecheck`, but the local TypeScript toolchain is not installed yet in this checkout, so the baseline command currently fails because `tsc` is unavailable.

## Product scope captured so far

- Desktop application built with Electron
- Standalone self-contained desktop app that bundles its local .NET backend
- Frontend implemented with React + Tailwind CSS in TypeScript
- Backend orchestration engine implemented with .NET + Microsoft Agent Framework
- Only Copilot SDK-backed agents are in scope for v1
- Users authenticate with their Copilot account
- Support for all MAF orchestration modes currently documented for workflows:
  - sequential
  - concurrent
  - handoff
  - group chat
-  - magentic (represented as unavailable in the current .NET implementation because Microsoft documents it as unsupported in C# today)
- Additional first-class single-agent chat mode for direct human-agent conversation
- Multiple projects/folders open in the app at the same time
- Reusable user-defined orchestration patterns stored in a global app-wide pattern library
- Session creation flow where the user selects both project and pattern

## Recommended architecture

### 1. Hybrid desktop structure

- **Electron main process**
  - application lifecycle
  - native dialogs and folder selection
  - spawning and supervising the .NET agent host
  - IPC boundary to the renderer
  - secure access to persisted local configuration
- **Electron renderer**
  - chat-first application shell
  - tree navigation for projects, sessions, and patterns
  - pattern management screens
  - session creation and session transcript views
- **.NET agent host**
  - wraps Microsoft Agent Framework orchestration capabilities
  - hosts Copilot SDK integrations
  - creates/runs sessions
  - validates and executes user-defined orchestration patterns
  - streams structured events back to Electron

### 2. Domain model

- **Workspace**: top-level local app state
- **Project**: a user-selected folder with metadata and project-specific sessions
- **Pattern**: reusable orchestration definition with mode, participating agents, instructions, and execution options
- **Agent definition**: provider/model/instructions/tools metadata used inside a pattern
- **Session**: a concrete run bound to one project and one pattern
- **Turn/Event**: chat messages, orchestration state changes, tool events, handoffs, completion states

### 3. Runtime boundary

- Confirmed v1 approach: Electron main launches a bundled local .NET sidecar process as part of a standalone self-contained app.
- Use a versioned structured contract for commands/events between Electron and the .NET host.
- The contract must support:
  - session creation
  - send message / user input
  - streaming assistant and orchestration events
  - session pause/abort/resume
  - pattern CRUD and validation
  - project/workspace metadata sync

### 4. UX slices

- **Left tree navigator**
  - workspace
  - projects
  - sessions under each project
  - shared global pattern library
- **Right main pane**
  - chat transcript
  - composer
  - session header/status
  - selected pattern summary
  - orchestration timeline or event rail for multi-agent runs
- **Create session flow**
  - choose project
  - choose pattern
  - optionally override models/instructions
  - launch and stream activity into the chat pane

### 5. Persistence

- Persist workspace metadata, known projects, patterns, sessions, transcripts, and resumable orchestration metadata in app data.
- Keep project source code in place; only store references to folders, not copies.
- Separate durable user configuration from transient runtime state.
- Store secrets and credentials in the OS keychain only.

### 6. Testing strategy

- TypeScript tests for desktop domain logic and renderer state
- .NET tests for pattern validation and orchestration execution
- Contract/integration tests for Electron-to-.NET messaging
- End-to-end smoke coverage for launching a project, starting a session, and streaming chat output

## Proposed implementation phases

### Phase 1 - Bootstrap the hybrid repository

- Add Electron application structure
- Add renderer application structure in TypeScript
- Add a .NET solution for the agent host
- Add unified local development scripts
- Establish repository layout for TS app and .NET backend

### Phase 2 - Define contracts and persistence

- Define workspace/project/pattern/session models
- Define command/event contracts between Electron and .NET
- Implement local persistence for workspace metadata and transcripts
- Implement durable session state/checkpoint persistence for resume after restart
- Integrate secure credential access through the OS keychain
- Add validation rules for pattern definitions

### Phase 3 - Implement the .NET agent host

- Integrate Microsoft Agent Framework and Copilot SDK-backed agents
- Build single-agent chat mode
- Build orchestration execution adapters for each supported MAF mode
- Implement streaming lifecycle events and error propagation

### Phase 4 - Build the desktop shell

- Build the chat-first application shell
- Implement the left-side tree navigator
- Implement session list/detail routing and selection state
- Implement project add/remove flows

### Phase 5 - Pattern authoring and session launch

- Build pattern list/editor UX
- Support agent configuration inside a pattern
- Allow session creation from a selected project and pattern
- Surface validation errors before launch

### Phase 6 - Reliability and polish

- Resume/reload session state after app restart
- Improve long-running orchestration visibility
- Add packaging, logging, and diagnostics
- Expand test coverage and development ergonomics

## Initial todo inventory

1. `bootstrap-electron-hybrid-repo`  
   Create the Electron + TypeScript renderer scaffold and add the .NET solution layout for the MAF host.

2. `define-domain-and-contracts`  
   Define workspace, project, pattern, agent, session, and event models plus the Electron/.NET command-event contract.

3. `implement-persistence-layer`  
   Persist workspace metadata, project references, patterns, session summaries, transcripts, and resumable state.

4. `build-dotnet-agent-host`  
   Create the .NET host process and integrate Microsoft Agent Framework plus Copilot SDK-backed agent support.

5. `implement-single-agent-chat-mode`  
   Deliver simple Copilot-CLI-style 1-on-1 chat as a first-class session type.

6. `wire-maf-orchestration-modes`  
   Add sequential, concurrent, handoff, group chat, and magentic pattern execution support.

7. `build-electron-shell-and-navigation`  
   Implement the left tree navigator and the chat-first main pane.

8. `build-pattern-management-ui`  
   Add CRUD workflows for reusable orchestration patterns and agent definitions.

9. `build-session-launch-and-streaming-ui`  
   Allow users to choose a project and pattern, start a session, and watch streaming events in chat.

10. `add-tests-and-packaging`  
    Add TypeScript/.NET/contract coverage and prepare desktop packaging and local developer workflows.

## Confirmed product decisions

- The app is packaged as a standalone self-contained Electron product with a bundled local .NET sidecar.
- The renderer uses React + Tailwind CSS.
- User-defined patterns are editable, reusable, and managed as a global library shared across projects.
- Sessions must resume after app restart and recover orchestration/chat state.
- Only Copilot SDK-backed agents are in scope for v1, using the user's Copilot account.
- Secrets and provider credentials are stored through the OS keychain.
- The current .NET implementation supports sequential, concurrent, handoff, and group chat; Magentic is surfaced as unavailable until C# support exists upstream.

## Remaining assumptions

- One desktop window is sufficient for v1.
- The right pane is primarily a chat experience, not a details-first inspector.
- Multi-agent orchestration should surface its event stream in a chat-adjacent way rather than in a separate heavy workflow designer first.
