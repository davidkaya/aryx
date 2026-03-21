# Backend UI Changes

This document describes changes to the .NET sidecar / backend protocol that would enable richer agent-activity reporting in the chat UI. These are **not yet implemented** — the current UI infers activity state from existing events. A separate agent should implement these changes.

## Context

The chat UI now shows a "Thinking…" indicator while the agent processes a request (before streaming starts) and a blinking cursor while the response streams in. These states are inferred from the existing `status` and `message-delta` session events.

To display more granular activity (e.g. "Using tool X…", "Agent Y is thinking…", "Handing off to Agent Z…"), the sidecar protocol needs a new event kind.

## Proposed protocol addition

### New event kind: `agent-activity`

Add a new value `'agent-activity'` to `SessionEventKind` in `src/shared/domain/event.ts`:

```typescript
export type SessionEventKind =
  | 'status'
  | 'message-delta'
  | 'message-complete'
  | 'agent-activity'   // ← new
  | 'error';
```

### New fields on `SessionEventRecord`

```typescript
export interface SessionEventRecord {
  sessionId: string;
  kind: SessionEventKind;
  occurredAt: string;

  // Existing fields…
  status?: 'idle' | 'running' | 'error';
  messageId?: string;
  authorName?: string;
  contentDelta?: string;
  error?: string;

  // New fields for 'agent-activity' events
  activityType?: 'thinking' | 'tool-calling' | 'handoff' | 'completed';
  agentName?: string;
  toolName?: string;
}
```

### Sidecar event mapping

The .NET sidecar should emit `agent-activity` events at these points:

| MAF lifecycle point | `activityType` | `agentName` | `toolName` |
|---|---|---|---|
| Agent begins processing a turn | `thinking` | agent name | — |
| Agent invokes a tool | `tool-calling` | agent name | tool name |
| Handoff orchestration transfers control | `handoff` | target agent name | — |
| Agent finishes its contribution | `completed` | agent name | — |

### .NET sidecar changes

In the sidecar's turn-execution pipeline, emit a new JSON event type alongside the existing `turn-delta` and `turn-complete`:

```json
{
  "type": "agent-activity",
  "requestId": "…",
  "sessionId": "…",
  "activityType": "tool-calling",
  "agentName": "Code Reviewer",
  "toolName": "read_file"
}
```

The Electron main process (`KopayaAppService`) should map this to a `SessionEventRecord` with `kind: 'agent-activity'` and forward it to the renderer via the existing `sessions:event` channel.

### Renderer consumption (already prepared)

Once these events are available, the `ChatPane` activity indicator can be enhanced to show contextual messages like:

- "Code Reviewer is thinking…"
- "Code Reviewer is using read_file…"
- "Handing off to Summarizer…"

The `ThinkingDots` component and activity indicator section in `ChatPane.tsx` are designed to be extended with this data.

## Files to change

| Layer | File | Change |
|---|---|---|
| Shared | `src/shared/domain/event.ts` | Add `'agent-activity'` to `SessionEventKind`, add optional `activityType` / `agentName` / `toolName` fields |
| Main | `src/main/sidecar/sidecar.ts` | Parse `agent-activity` events from sidecar JSON output |
| Main | `src/main/KopayaAppService.ts` | Map parsed activity events to `SessionEventRecord` and emit via `session-event` |
| Sidecar | `sidecar/src/Kopaya.AgentHost/…` | Emit `agent-activity` JSON events during MAF turn execution |
