# Kopaya Roadmap

Last updated: 2026-03-23

## Product direction

Kopaya already has the foundation of a serious AI workstation: local projects, persistent sessions, reusable orchestration patterns, live streaming, per-agent activity, and a sidecar runtime that can evolve independently of the desktop app.

The next step should not be "add random AI features." It should be to turn Kopaya into the best control room for AI work on real projects:

- chat when the user wants speed
- orchestrate when the user wants depth or quality
- inspect when the user needs trust
- automate when the user wants leverage

Modern AI chat apps set a clear baseline for user expectations: projects, memory, attachments, branching, search, export, collaboration, and task automation. Kopaya should meet that baseline, then go further on orchestration, observability, and reproducibility.

## Current baseline

Based on the current codebase, Kopaya already has:

- [x] persistent local workspace state for projects, patterns, and sessions in `src/main/persistence/workspaceRepository.ts`
- [x] built-in orchestration modes in `src/shared/domain/pattern.ts`: `single`, `sequential`, `concurrent`, `handoff`, `group-chat`, with `magentic` reserved for future support
- [x] a dynamic model catalog with provider metadata and reasoning-effort support in `src/shared/domain/models.ts`
- [x] scratchpad-specific in-chat model overrides in `src/main/KopayaAppService.ts`
- [x] real-time turn streaming and agent activity events in `src/shared/contracts/sidecar.ts`, `src/shared/domain/event.ts`, and `sidecar/src/Kopaya.AgentHost/Services/CopilotWorkflowRunner.cs`
- [x] a right-side activity panel that already surfaces per-agent state, model, and effort in `src/renderer/components/ActivityPanel.tsx`
- [x] a pattern editor and settings flow in `src/renderer/components/SettingsPanel.tsx`
- [x] Copilot CLI-backed runtime access via the system-installed `copilot` command, with Kopaya sanitizing inherited runtime env vars before spawning the sidecar
- [x] refreshable Copilot connection diagnostics and settings UI for `ready`, `copilot-cli-missing`, `copilot-auth-required`, and `copilot-error` states in `src/renderer/components/CopilotStatusCard.tsx`, `src/renderer/components/SettingsPanel.tsx`, `src/main/KopayaAppService.ts`, and `sidecar/src/Kopaya.AgentHost/Services/SidecarProtocolHost.cs`
- [x] an OS secret store wrapper in `src/main/secrets/secretStore.ts` that can support future non-Copilot secrets and integrations

That is a strong base. The biggest gaps are not around "can it run agents?" but around:

- user trust and visibility
- project and conversation management
- automation safety
- collaboration and sharing
- turning orchestration into a first-class product advantage

## Guiding principles

1. Match core AI chat expectations first.
   If Kopaya is missing search, attachments, export, branching, or memory controls, users will feel friction before they ever appreciate orchestration.

2. Make orchestration legible.
   Multi-agent systems are only valuable if users can see what happened, why it happened, and what each agent contributed.

3. Keep the human in control.
   Approval gates, replay, budgets, scopes, and traceability matter more than raw autonomy.

4. Make runs reproducible.
   A useful orchestration product should let users compare runs, pin configurations, inspect versions, and understand why outcomes changed.

5. Build around real project work.
   Kopaya should feel strongest when attached to a codebase or working directory, not just as a generic chatbot.

## Roadmap themes

## 1. Must-have product gaps to close

These are the improvements users will expect from any serious AI desktop app.

| Priority | Initiative                                       | Why users need it                                                                                                                                | Likely layers               |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Highest  | Copilot connection and account status management | Users need a clear way to see whether Copilot is installed, authenticated, healthy, and able to serve the expected models.                       | Renderer, main, sidecar     |
| Highest  | Conversation organization and search             | Users need to find old work quickly, pin important threads, archive noise, and search by project, title, agent, and content.                     | Renderer, persistence       |
| Highest  | Session export and sharing                       | Users will want to export runs to Markdown/JSON/PDF, share patterns, and preserve outcomes outside the app.                                      | Renderer, main, persistence |
| High     | Attachments and artifact handling                | Modern chat apps let users drop files into a thread and keep generated artifacts nearby. This is table stakes for research and coding workflows. | Renderer, main, sidecar     |
| High     | Chat branching and session forking               | Users need to explore alternate solution paths without losing the original conversation.                                                         | Renderer, persistence       |
| High     | Better error and diagnostics UX                  | Sidecar/runtime issues need clear explanation, retry actions, and debug details instead of vague failure states.                                 | Renderer, main, sidecar     |

### What this should look like

#### Copilot connection and account status management

Implemented foundation:

- [x] a dedicated settings area for Copilot install, login, and connection health
- [x] installed / missing Copilot CLI state
- [x] logged in / auth-required / broken connection state
- [x] refresh and last-validated status

Still worth adding:

- [x] outdated Copilot CLI state
- [x] active GitHub account or organization context when available
- [ ] clear model availability explanation when a model is unavailable
- [ ] reconnect and troubleshooting actions beyond refresh
- [ ] optional per-project or per-pattern account selection later if Kopaya supports multiple Copilot identities

Because Kopaya currently appears to authenticate through the system-installed Copilot CLI rather than owning provider secrets directly, this should be treated as a connection/account-state UX problem first, not a raw credential-storage problem.

If Kopaya later adds direct OpenAI, Anthropic, Google, MCP, or team-managed secrets, broader credential management becomes a separate roadmap item. The existing `src/main/secrets/secretStore.ts` gives the product a natural place to grow when that happens.

#### Conversation organization and search

- [x] global search across sessions, messages, projects, and patterns
- [x] pinned sessions, archived sessions
- [ ] filters like "running", "errored", "scratchpad", "project X", "pattern Y"
- [x] duplicate session, rename session, and favorite pattern
- [ ] lightweight tags
- [ ] recent activity views and "resume where I left off"

The shared/backend query layer supports these filters, but the dedicated filter UI is currently deferred.

#### Session export and sharing

- [ ] export a full run to Markdown
- [ ] export machine-readable JSON for debugging and replay
- [ ] copy/share a clean transcript without internal activity noise
- [ ] export a pattern with its agents, instructions, and model selections

#### Attachments and artifacts

- [ ] drag-and-drop files into chat
- [ ] inline preview for code, Markdown, images, and PDFs
- [ ] artifact shelf for generated outputs
- [ ] "open in project", "save as", and "promote to workspace artifact"

#### Chat branching and session forking

- [ ] fork from any message
- [ ] compare branch A vs branch B
- [ ] keep separate titles and summaries for each branch
- [ ] optionally turn a fork into a new pattern experiment

#### Better error and diagnostics UX

- [ ] collapsible run diagnostics panel
- [ ] sidecar logs per session
- [ ] retry failed turn
- [ ] "why did this fail?" summaries
- [ ] copyable debug bundle for issue reports

## 2. Project-aware coding improvements

Kopaya should feel much smarter about the project it is attached to.

| Priority | Initiative                       | Why it matters                                                                    | Likely layers                  |
| -------- | -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| Highest  | Project context controls         | Users need to know what the agents can see and what is excluded.                  | Renderer, main, sidecar        |
| High     | Git-aware context                | Branch, diff, dirty state, and commit context are essential for coding workflows. | Main, renderer                 |
| High     | Workspace indexing and summaries | Large projects need a fast, understandable overview before orchestration starts.  | Main, sidecar, persistence     |
| High     | File pinning and working sets    | Users need to constrain attention to a selected set of files or folders.          | Renderer, persistence, sidecar |
| Medium   | Project presets                  | Teams will want reusable project-level context, rules, and exclusion templates.   | Persistence, renderer          |

### Recommended features

- [ ] show project metadata: repo name, branch, dirty state, languages, package managers, solution files
- [ ] explicit include/exclude controls using gitignore-aware defaults plus manual overrides
- [ ] working set support: "only reason about these files/folders"
- [ ] project summary card: architecture snapshot, detected stack, test commands, important entry points
- [ ] saved session context packs, such as "frontend only", "API layer", or "build pipeline"

This is where Kopaya can beat generic chat apps: not just talking about a project, but acting like a focused control surface for that project.

## 3. Orchestration control plane

This is the highest-leverage product area. If done well, it becomes Kopaya's signature advantage.

| Priority | Initiative                     | Why users need it                                                                        | Likely layers                  |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------ |
| Highest  | Rich run timeline              | Users need to see the exact sequence of thinking, handoffs, tool calls, and outputs.     | Renderer, sidecar              |
| Highest  | Replayable run traces          | Users need to inspect how a result was produced, not just read the final answer.         | Sidecar, persistence, renderer |
| High     | Pattern versioning             | Users need to know which pattern version produced which session.                         | Persistence, renderer          |
| High     | Run comparison lab             | Users need to compare models, patterns, prompts, or reasoning settings side by side.     | Renderer, persistence, sidecar |
| High     | Guardrails and policy controls | Users need caps for cost, tools, runtime, file access, and escalation behavior.          | Renderer, sidecar, persistence |
| High     | Approval checkpoints           | Users need pause-and-approve steps before risky tool use, file writes, or final actions. | Renderer, sidecar              |

### Rich run timeline

The current activity model already exposes `thinking`, `tool-calling`, `handoff`, and `completed`.

Build on that with:

- [ ] a vertical run timeline in the side panel
- [ ] event cards with timestamps, agent identity, tool name, and result status
- [ ] per-agent run lanes
- [ ] grouping of streaming deltas into one coherent answer step
- [ ] jump-to-message and jump-to-agent actions

### Replayable run traces

- [ ] store a structured event log per run
- [ ] replay a completed run step by step
- [ ] scrub through the run like a debugger timeline
- [ ] inspect the exact sequence of agent activations and tool invocations
- [ ] preserve environment metadata such as model, effort, project path, and pattern version

This would be a major differentiator. Most chat apps show outputs; very few make multi-agent execution truly inspectable.

### Pattern versioning

- [ ] immutable versions for saved patterns
- [ ] "session used pattern v7"
- [ ] diff view for instructions, models, agents, and iteration counts
- [ ] rollback and duplicate-from-version
- [ ] changelog notes for team-facing patterns

### Run comparison lab

- [ ] run the same user prompt against multiple patterns or model mixes
- [ ] compare output quality, latency, handoff structure, and cost
- [ ] save a winner as the new default
- [ ] benchmark patterns against a reusable prompt set

### Guardrails and policy controls

- [ ] max iterations per run
- [ ] max tool calls per agent
- [ ] time budget and cost budget
- [ ] allowed tools per pattern
- [ ] allowed paths per project
- [ ] "tool use requires approval" mode

### Approval checkpoints

- [ ] pause before a tool call
- [ ] pause before handing off outside the original working set
- [ ] pause before final answer publication
- [ ] assign specific checkpoints to specific agents or pattern modes

## 4. Advanced orchestration capabilities

Once the control plane is solid, Kopaya should move from multi-agent chat to true workflow orchestration.

| Priority | Initiative                        | Why it matters                                                                            | Likely layers                     |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------- |
| High     | Planner-executor-evaluator loops  | Strong default pattern for quality, validation, and self-correction.                      | Sidecar, pattern system, renderer |
| High     | Conditional routing and DAG flows | Real workflows need branching, retries, and conditional steps beyond today's fixed modes. | Pattern system, sidecar, renderer |
| High     | Background and long-running jobs  | Users need runs that continue while they browse or switch sessions.                       | Main, sidecar, renderer           |
| Medium   | Cross-project campaigns           | Some workflows should coordinate across multiple repositories or workspaces.              | Persistence, sidecar, renderer    |
| Medium   | Memory layers                     | Users need structured memory beyond raw chat history.                                     | Persistence, sidecar, renderer    |
| Medium   | Autonomy levels                   | Some runs should be advisory, some supervised, some semi-autonomous.                      | Renderer, sidecar, persistence    |
| Backlog  | Magentic mode support             | Already reserved in the domain model and should activate when the runtime supports it.    | Sidecar, shared domain, renderer  |

### Planner-executor-evaluator loops

Add first-class support for patterns like:

- [ ] planner -> implementer -> reviewer
- [ ] researcher -> synthesizer -> critic
- [ ] triage -> specialist -> verifier
- [ ] generator -> judge -> repair loop until threshold

This should be more than custom instructions. It should be a product concept with templates, visibility, and metrics.

### Conditional routing and DAG flows

Move beyond a fixed list of orchestration modes and introduce:

- [ ] conditional edges
- [ ] retries on low confidence
- [ ] fallback agent paths
- [ ] multi-branch flows that rejoin
- [ ] "if tool X returns Y, route to specialist Z"

A node-and-edge designer would make this much easier to understand than a purely form-based editor.

### Background and long-running jobs

- [ ] queue runs for later
- [ ] continue in the background while the user works elsewhere
- [ ] desktop notifications when a run reaches a checkpoint or fails
- [ ] background research, repo audits, doc generation, or code review workflows

### Cross-project campaigns

Examples:

- [ ] audit the same policy across multiple repositories
- [ ] generate migration plans across a workspace portfolio
- [ ] compare implementation patterns across projects
- [ ] run one planner over many project-specific executor sessions

### Memory layers

Kopaya should eventually distinguish between:

- [ ] session memory: just this thread
- [ ] project memory: facts about a specific repository
- [ ] pattern memory: lessons or defaults attached to a workflow
- [ ] user preferences: tone, depth, risk tolerance, approval defaults
- [ ] team memory: shared conventions and approved instructions

Users should be able to inspect, edit, clear, and scope each memory layer.

### Autonomy levels

Introduce explicit run modes such as:

- [ ] advisory only
- [ ] supervised execution
- [ ] auto-run within guardrails
- [ ] background delegated task

This gives users a clearer mental model than burying autonomy inside pattern instructions.

## 5. Team, collaboration, and governance

Single-user desktop value is important, but long-term adoption will benefit from team workflows.

| Priority | Initiative                         | Why users need it                                              | Likely layers                       |
| -------- | ---------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| High     | Pattern import/export and registry | Teams need to share proven workflows.                          | Persistence, renderer               |
| High     | Shared run reports                 | Users need a clean way to send outcomes to teammates.          | Renderer, persistence               |
| Medium   | Team workspaces                    | Shared projects, pattern libraries, and session visibility.    | Persistence, backend services       |
| Medium   | Comments and annotations           | Humans need to discuss runs and approve or reject outputs.     | Renderer, persistence               |
| Medium   | Audit logs and secret governance   | Important for enterprise or regulated use.                     | Main, persistence, backend services |
| Medium   | Roles and permissions              | Useful once teams share patterns, credentials, and automation. | Backend services, renderer          |

### Practical collaboration features

- [ ] comment on a pattern version
- [ ] share a run summary instead of a raw transcript
- [ ] mark a pattern as approved, experimental, or deprecated
- [ ] create a pattern library with tags like "coding", "docs", "triage", "research"
- [ ] import/export pattern bundles

## 6. Evaluation and continuous improvement

If Kopaya is going to orchestrate important work, it needs a way to measure quality.

| Priority | Initiative                       | Why it matters                                                       | Likely layers                  |
| -------- | -------------------------------- | -------------------------------------------------------------------- | ------------------------------ |
| High     | Prompt and pattern eval suites   | Users need a repeatable way to see if a pattern got better or worse. | Persistence, sidecar, renderer |
| High     | Regression testing for workflows | Teams need confidence before updating a widely used pattern.         | Sidecar, persistence           |
| Medium   | Run quality scoring              | Helpful for ranking candidate outputs and routing retries.           | Sidecar, renderer              |
| Medium   | Cost/latency analytics           | Users need to understand trade-offs between quality and speed.       | Sidecar, persistence, renderer |
| Medium   | Golden datasets for coding tasks | Useful for tuning workflows for a repository or team.                | Persistence, tooling           |

### What this could unlock

- "Did our new reviewer pattern improve outcomes?"
- "Which model mix gives us the best quality-per-cost?"
- "Which prompts or projects frequently fail and why?"
- "Should this workflow stay sequential or become concurrent?"

This is where Kopaya can become an engineering tool, not just a conversation shell.

## 7. Signature bets that could make Kopaya stand out

These are the ideas with the best chance of making Kopaya feel distinct rather than merely competitive.

### 1. Orchestration debugger

A proper debugger for AI runs:

- [ ] event timeline
- [ ] step replay
- [ ] handoff graph
- [ ] tool call trace
- [ ] per-agent output inspection
- [ ] final answer provenance

This would make complex agent runs understandable in a way most products do not.

### 2. Chat-to-pattern promotion

Let a user turn an ad hoc scratchpad conversation into a reusable orchestration pattern:

- [ ] detect the roles that emerged
- [ ] suggest agent breakdowns
- [ ] convert a successful chat into a draft workflow
- [ ] save the resulting pattern back into the library

This would connect casual use and power-user workflow design.

### 3. Compare lab for models and orchestration

Instead of just comparing model outputs, compare:

- [ ] one agent vs multi-agent
- [ ] sequential vs concurrent
- [ ] GPT-heavy vs Claude-heavy
- [ ] high-effort vs medium-effort
- [ ] guarded vs unguarded runs

Kopaya should become the easiest place to answer, "which setup is actually better for this task?"

### 4. Human checkpoints as a first-class orchestration feature

Most agent tools either automate too much or stop at chat. Kopaya can own the middle ground:

- [ ] route to human review at key points
- [ ] require approval before tool execution or publishing
- [ ] allow humans to override, edit, or redirect handoffs

### 5. Reproducible run snapshots

Every important run should be reproducible with a snapshot of:

- [ ] project path or repo revision
- [ ] pattern version
- [ ] agent list
- [ ] model selection
- [ ] reasoning effort
- [ ] tool permissions
- [ ] event trace

This is especially valuable for engineering and enterprise use cases.

## 8. Suggested sequencing

The best sequence is not to chase the fanciest orchestration idea first. It is to remove friction, then build trust, then expand power.

### Phase A: Reach modern chat-app baseline

Focus on:

- complete the remaining Copilot connection and account status management work
- conversation search and organization
- export/share
- attachments and artifacts
- session forking
- better failure UX

### Phase B: Make orchestration visible and trustworthy

Focus on:

- richer activity timeline
- replayable traces
- pattern versioning
- run comparison
- guardrails
- approval checkpoints

### Phase C: Expand orchestration power

Focus on:

- planner-executor-evaluator templates
- DAG and conditional routing
- background jobs
- memory layers
- project context packs
- git-aware workflows

### Phase D: Build the team platform

Focus on:

- pattern registry
- shared workspaces
- audits and governance
- evaluations and regression tooling
- role-based collaboration

## 9. Recommended shortlist for the next wave

If only a handful of roadmap items are chosen next, these would likely create the most user value:

1. Finish the remaining Copilot connection and account settings work
2. Conversation search, pinning, archive, and export
3. Session forking and branch comparison
4. Project context controls with git-aware working sets
5. Rich orchestration timeline and replay
6. Pattern versioning plus import/export
7. Approval checkpoints and run guardrails

## 10. Lower-priority ideas for now

These may still be valuable, but they are less urgent than the items above:

- voice-first interaction
- mobile companion apps
- social or marketplace-heavy features
- decorative agent personas without functional value
- generic consumer-chat features that do not improve project work or orchestration quality

## Final takeaway

Kopaya does not need to become "another AI chat app."

It should become:

- a strong AI chat app for real project work
- the clearest way to understand and supervise multi-agent execution
- the best place to compare, debug, and improve orchestration patterns over time

If the product closes the baseline gaps and then leans hard into orchestration visibility, reproducibility, and human control, it can occupy a much more interesting position than generic chat tools.
