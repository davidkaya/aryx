<p align="center">
  <img src="assets/icons/icon.png" alt="Aryx logo" width="180" />
</p>

<h1 align="center">Aryx</h1>

<p align="center">
  A desktop workspace for Copilot-powered work across real projects.
</p>

<p align="center">
  <a href="https://github.com/davidkaya/aryx/releases">Download</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://aryx.app">Website</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="https://github.com/davidkaya/aryx/issues">Issues</a>
</p>

---

Aryx is a desktop app that turns GitHub Copilot into a full workspace. Connect real projects, orchestrate multi-agent workflows, and keep persistent sessions organized — instead of starting from scratch in a blank chat window every time. It runs on Windows, macOS, and Linux.

## Highlights

- **Multi-agent orchestration** — single, sequential, concurrent, handoff, and group-chat patterns with a visual graph editor.
- **Project-grounded** — attach local folders and repos so every conversation has real codebase context.
- **Live execution visibility** — watch agents think, delegate, call tools, and consume context in real time.
- **Persistent workspace** — sessions survive restarts. Search, pin, archive, branch, and return to past work.
- **Extensible tooling** — MCP servers, LSP profiles, project hooks, and fine-grained tool approval controls.
- **Keyboard-first** — command palette, rich shortcuts, mid-turn steering, and a built-in terminal.

## How it works

1. **Launch Aryx** — the app checks your Copilot CLI connection and shows status on the home screen.
2. **Connect a project** or open a scratchpad for quick questions without any setup.
3. **Pick a pattern** — choose a single-agent chat or a saved multi-agent orchestration workflow.
4. **Work** — ask questions, steer agents mid-turn, watch live activity, and keep the session for later.

## Features

### Workspace & sessions

| Feature | Description |
|---------|-------------|
| Scratchpad sessions | Quick questions with isolated working directories — no project setup needed |
| Persistent sessions | Rename, pin, archive, duplicate, and return to sessions across restarts |
| Session branching | Fork a session at any user message to explore a different direction |
| Session search | Full-text search across all session messages, not just titles |
| Message actions | Copy, pin, edit-and-resend, and regenerate individual messages |
| System tray | Minimize to tray, quick-launch scratchpads, and see running session count |
| Desktop notifications | Native OS alerts when runs complete, fail, or need approval |
| Onboarding | First-launch walkthrough, interactive tooltips, and a "try it" quickstart |

### Agent intelligence

| Feature | Description |
|---------|-------------|
| Orchestration patterns | Single, sequential, concurrent, handoff, and group-chat agent flows |
| Visual pattern editor | Drag nodes, draw connections, and inspect each step in a graph view |
| Mid-turn steering | Send follow-up messages while an agent is running — input is injected immediately |
| Plan review & questions | Agents propose plans and ask clarifying questions before acting |
| Run timeline | Structured history of tool calls, delegations, hooks, and context usage |
| Copilot customization | Auto-discovers instructions, agent profiles, and prompt files from your repo |
| Model & effort tuning | Choose models, adjust reasoning effort, and set interaction modes per session |

### Developer tooling

| Feature | Description |
|---------|-------------|
| Real project context | Attach folders and repos — see branch, dirty state, and ahead/behind status |
| MCP servers | Define servers globally, enable per session, auto-discover from project configs |
| LSP profiles | Language server integration for code intelligence in agent workflows |
| Tool approval | Fine-grained approval policies with pattern-level defaults and per-session overrides |
| Project hooks | Auto-discovers `.github/hooks/*.json` and runs lifecycle hooks in the sidecar |
| Image input | Attach screenshots, diagrams, or photos for visual reasoning |
| Integrated terminal | Full PTY-backed terminal inside the workspace (`Ctrl+\``) |
| Command palette | `Ctrl+K` fuzzy search across actions, sessions, and settings |
| Keyboard shortcuts | Comprehensive keybindings with a cheat sheet via `Ctrl+/` |

## Prerequisites

- **GitHub Copilot CLI** installed and available as `copilot`
- An active **GitHub Copilot** sign-in
- Windows, macOS, or Linux

Aryx shows your Copilot connection status in the app so you know if authentication is ready before starting a session.

## Development

```sh
bun run test           # typecheck + unit tests
bun run sidecar:test   # backend tests
bun run build          # full build (electron + sidecar)

bun run package        # package for current platform → release/
bun run installer      # create installable artifact
bun run publish-release # publish to GitHub Releases
```

Tagged releases use GitHub Actions to build and publish Windows (NSIS), macOS (DMG, signed + notarized), and Linux (AppImage) artifacts. The app uses `electron-updater` for in-app updates.

## Trademarks

GitHub and GitHub Copilot are trademarks of Microsoft Corporation. Aryx is an independent project, not affiliated with or endorsed by Microsoft or GitHub.
