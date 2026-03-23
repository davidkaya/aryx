# Rich run timeline handover

This change implements the backend half of the `Rich run timeline` roadmap item and leaves the actual timeline UI/UX for the next agent.

## What is done

- Persisted structured run history on every `SessionRecord`
- Added a shared run/timeline domain model for durable per-run metadata and ordered timeline events
- Started a new run record whenever `sendSessionMessage(...)` kicks off a turn
- Grouped streamed assistant output into a single timeline message event keyed by `messageId`
- Persisted timeline updates during agent activity, message streaming, completion, and failure
- Added explicit handoff source metadata so the future UI can draw source/target handoff edges
- Added a live `run-updated` session event so the renderer can receive timeline changes incrementally without waiting for a full workspace refresh
- Kept duplicate-session behavior simple and safe: duplicated sessions copy transcript/tooling config but start with `runs: []`

## Important files

- `src/shared/domain/runTimeline.ts`
  - New shared types and helpers:
    - `SessionRunRecord`
    - `RunTimelineEventRecord`
    - `createSessionRunRecord(...)`
    - `appendRunActivityEvent(...)`
    - `upsertRunMessageEvent(...)`
    - `completeSessionRunRecord(...)`
    - `failSessionRunRecord(...)`
- `src/shared/domain/session.ts`
  - `SessionRecord` now includes `runs: SessionRunRecord[]`
- `src/main/persistence/workspaceRepository.ts`
  - Normalizes persisted `session.runs`
- `src/main/EryxAppService.ts`
  - Creates and updates run records during turn execution
  - Emits live `run-updated` session events
- `src/shared/domain/event.ts`
  - Added session event kind `run-updated`
  - Added optional `run` payload on `SessionEventRecord`
- `src/renderer/lib/sessionWorkspace.ts`
  - Applies `run-updated` events by replacing/inserting the full run snapshot
- `src/shared/contracts/sidecar.ts`
  - `AgentActivityEvent` now carries optional `sourceAgentId` / `sourceAgentName`
- `sidecar/src/Eryx.AgentHost/Contracts/ProtocolModels.cs`
  - C# DTO mirror for the new handoff source fields
- `sidecar/src/Eryx.AgentHost/Services/CopilotWorkflowRunner.cs`
  - Handoff activity now includes the active/source agent when available

## Backend contract

### Session shape

Every session now has:

```ts
runs: SessionRunRecord[]
```

Runs are stored newest-first.

### `SessionRunRecord`

Key fields:

- `id`
- `requestId`
- `projectId`
- `projectPath`
- `workspaceKind`
- `patternId`
- `patternName`
- `patternMode`
- `triggerMessageId`
- `startedAt`
- `completedAt?`
- `status`
- `agents`
- `events`

`agents` is the per-run lane metadata the UI should use for lane headers / agent grouping.

### `RunTimelineEventRecord`

Event kinds:

- `run-started`
- `thinking`
- `handoff`
- `tool-call`
- `message`
- `run-completed`
- `run-failed`

Useful payload fields:

- `occurredAt`
- `updatedAt?`
- `status`
- `agentId` / `agentName`
- `sourceAgentId` / `sourceAgentName`
- `targetAgentId` / `targetAgentName`
- `toolName`
- `messageId`
- `content`
- `error`

### Live update event

The renderer now receives:

```ts
{
  sessionId: string;
  kind: 'run-updated';
  occurredAt: string;
  run: SessionRunRecord;
}
```

This is a full run snapshot, not a delta patch. The reducer already replaces/upserts the run for the selected session.

## Current runtime behavior

### Run start

`sendSessionMessage(...)` now:

1. appends the user message
2. creates a new `SessionRunRecord`
3. persists the workspace
4. starts the turn

The initial run contains a `run-started` event pointing at `triggerMessageId`.

### Thinking / handoff / tool activity

Agent activity events now append timeline entries:

- `thinking`
- `handoff`
- `tool-call`

For handoffs, the backend now stores both source and target when the source agent is known.

### Streamed assistant output

Message streaming is grouped into one `message` event per `messageId`.

During streaming:

- the existing message event is updated in place
- `status` stays `running`
- `content` holds the latest snapshot
- `updatedAt` advances

On completion:

- the same event becomes `status: 'completed'`
- final content is persisted

### Run completion / failure

Successful runs append `run-completed`.

Failed runs append `run-failed` and also mark any still-running message events as errored.

## Notes for the UI/UX agent

You do **not** need new IPC or backend endpoints for the first timeline UI pass.

Use:

- `session.runs` for initial render / reload
- live `run-updated` session events for in-flight changes

Suggested UI plan:

1. Replace or reframe the current agent-activity tiles around the run model instead of mixing unrelated tiles together.
2. Show runs newest-first in the side panel.
3. Inside a run, render a vertical timeline ordered by `events[]`.
4. Use `agents[]` to build per-agent lanes or grouped headers.
5. Render `message` events as the coherent answer step for streamed assistant output.
6. Use `messageId` and `triggerMessageId` for jump-to-message actions.
7. Use `agentId`, `sourceAgentId`, and `targetAgentId` for jump-to-agent / handoff visuals.

## UX-specific suggestions

- `run-started`: compact start card linked to the triggering user message
- `thinking`: lightweight state card or inline badge in the agent lane
- `handoff`: directional edge/card from source -> target
- `tool-call`: small tool chip/card with tool name and agent
- `message`: the main rich output card; this is the item that should expand/collapse cleanly
- `run-completed` / `run-failed`: footer-style terminal state card

## Known limitations / open questions

- There is no dedicated persisted `completed` activity event. Final assistant output plus `run-completed` is the canonical completion signal for now.
- Tool results are not persisted yet; only tool invocation metadata is stored.
- Pattern version metadata is not persisted yet; only `patternId`, `patternName`, and `patternMode` are captured.
- Duplicate sessions intentionally start with empty run history. If product wants copied traces later, that needs an explicit decision.
- Live `run-updated` events currently send the full run snapshot each time. That keeps the reducer simple; optimize later only if payload size becomes a problem.

## Validation completed

- `bun run typecheck`
- `bun test`
- `bun run sidecar:test`
- `bun run build`
