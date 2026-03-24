<p align="center">
  <img src="assets/icons/icon.png" alt="Eryx logo" width="180" />
</p>

<h1 align="center">Eryx</h1>

<p align="center">
  A desktop workspace for Copilot-powered work across real projects.
</p>

Eryx is built for people who want more than a generic AI chat window. It gives you a place to ask quick questions, connect real projects, run reusable agent patterns, and keep ongoing work organized in one app.

It works especially well when you want AI help that stays grounded in an actual codebase: your folders, your repository state, your current branch, and your active work.

## Why use Eryx?

- **Start fast** with a scratchpad conversation for quick questions and ad-hoc work.
- **Work against real projects** by attaching local folders and letting Eryx stay aware of repository context.
- **Go beyond one assistant** with orchestration patterns such as single-agent, sequential, concurrent, handoff, and group-chat flows.
- **See what is happening** with live activity for each agent while a run is in progress.
- **Stay organized** with persistent sessions you can rename, pin, archive, and return to later.
- **Tune how you work** by choosing models and reusing saved patterns that fit different tasks.

## What you can do in the app

### Ask quick questions in a scratchpad

If you just want to think through an idea, draft something, or ask for help without connecting a project, start a scratchpad session and begin chatting.

### Connect a real project

Add a local folder when you want help that is grounded in your work. Eryx is designed to feel strongest when it is attached to a real project instead of acting like a general-purpose chatbot.

### Choose how agents collaborate

Eryx supports several ways of working:

- **Single** for direct one-agent help
- **Sequential** for step-by-step specialist workflows
- **Concurrent** for parallel exploration
- **Handoff** for agent-to-agent delegation
- **Group chat** for collaborative multi-agent discussion

### Add global MCPs and LSPs

You can define MCP servers and LSP profiles once in **Settings**, then enable the ones you want for each project-backed session from the right-side **Activity** panel.

This keeps machine-wide tooling reusable while still letting each session decide which external tools the agent can use.

Patterns can also store default auto-approval for known MCP and LSP tools, and each session can override those defaults from the Activity panel before a run starts.

### Watch runs as they happen

You can follow agent activity while a session is running, which makes longer or more complex workflows easier to trust and understand.

### Keep important work around

Sessions are persistent, so you can return to ongoing work instead of starting from scratch every time. You can also rename, pin, archive, and duplicate sessions as your workspace grows.

## Before you start

To use Eryx comfortably, make sure you have:

- a **Windows machine**
- **GitHub Copilot CLI** installed and available as `copilot`
- an active **GitHub Copilot sign-in**
- a local folder or git repository ready to connect if you want project-aware help
- any MCP servers or language servers you want to use installed and reachable from your machine

Eryx includes connection status in the app so you can quickly tell whether Copilot is ready before you start a session.

## Getting started

1. **Open Eryx**
   Launch the app and head to settings if you want to confirm your Copilot connection first.

2. **Check that Copilot is ready**
   Make sure the app shows that Copilot is installed and authenticated.

3. **Choose how you want to begin**
   Start a scratchpad session for quick work, or add a project if you want the conversation grounded in a local codebase.

4. **Pick a pattern**
   Use a simple single-agent setup to begin, or choose a saved multi-agent pattern when you want a more structured workflow.

5. **Configure optional tooling**
   If you want MCP or LSP support, add the global definitions in settings and then enable the ones you want for the current session from the Activity panel. You can also set pattern-level tool auto-approval defaults and override them per session.

6. **Start working**
   Ask a question, describe a task, or explore a project. As the run progresses, you can watch the participating agents and keep the session for later.

## When Eryx feels most useful

Eryx shines when you want to:

- move from quick chat to deeper multi-step work without leaving the app
- keep AI conversations tied to actual projects instead of isolated prompts
- compare different ways of approaching the same task
- reuse patterns for recurring workflows
- maintain a history of meaningful sessions instead of disposable chats

## Build and release automation

For local validation, run:

- `bun run test`
- `bun run sidecar:test`
- `bun run build`

To package the current platform into `release/`, run:

- `bun run package`

GitHub Actions now runs validation on pushes and pull requests, and pushing a git tag creates a GitHub release with Windows, macOS, and Linux assets uploaded directly to the release.

## Current focus

Eryx is focused on local, project-based work with your GitHub Copilot account. It already covers the essentials for working with projects, sessions, and reusable orchestration patterns, and it is growing toward a fuller AI workstation experience over time.

If you want an AI app that feels closer to a control room for real work than a blank chat box, Eryx is built for that.
