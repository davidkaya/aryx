# Backend UI Changes

This document describes the implemented .NET sidecar / backend protocol changes that enable richer agent-activity reporting in the chat UI.

The repository now emits and consumes `agent-activity` events end to end. Because the current MAF workflow stream does not expose every lifecycle detail uniformly, activity events are emitted only when they can be detected reliably from the available workflow events.

## Context

The chat UI now shows a "Thinking…" indicator while the agent processes a request (before streaming starts) and a blinking cursor while the response streams in. These states are inferred from the existing `status` and `message-delta` session events.

To display more granular activity (e.g. "Using tool X…", "Agent Y is thinking…", "Handing off to Agent Z…"), the sidecar protocol uses a new event kind.

## Protocol addition

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
  agentId?: string;
  agentName?: string;
  toolName?: string;
}
```

### Sidecar event mapping

The .NET sidecar emits `agent-activity` events when the workflow stream exposes these points reliably:

| MAF lifecycle point | `activityType` | `agentName` | `toolName` |
|---|---|---|---|
| Agent begins processing a turn | `thinking` | agent name | — |
| Agent invokes a tool | `tool-calling` | agent name | tool name |
| Handoff orchestration transfers control | `handoff` | target agent name | — |
| Agent finishes its contribution | `completed` | agent name | — |

In practice, `thinking` and `completed` are driven by executor lifecycle events, while `tool-calling` and `handoff` are emitted when request-info payloads expose recognizable tool-call or handoff targets.

### .NET sidecar changes

In the sidecar's turn-execution pipeline, emit a new JSON event type alongside the existing `turn-delta` and `turn-complete` events:

```json
{
  "type": "agent-activity",
  "requestId": "…",
  "sessionId": "…",
  "activityType": "tool-calling",
  "agentId": "agent-reviewer",
  "agentName": "Code Reviewer",
  "toolName": "read_file"
}
```

The Electron main process maps this to a `SessionEventRecord` with `kind: 'agent-activity'` and forwards it to the renderer via the existing `sessions:event` channel.

### Renderer consumption

`App.tsx` now subscribes to `onSessionEvent` and tracks live activity per agent for the selected session. `ChatPane.tsx` uses that state to show a status row for each agent while the run is active.

- "Code Reviewer is thinking…"
- "Code Reviewer is using read_file…"
- "Handing off to Summarizer…"

The activity panel in `ChatPane.tsx` is now wired to this data, showing every agent in the pattern with a current status such as waiting, thinking, tool usage, handoff, or completed.

## Files involved

| Layer | File | Change |
|---|---|---|
| Shared | `src/shared/domain/event.ts` | Add `'agent-activity'` to `SessionEventKind`, add optional `activityType` / `agentId` / `agentName` / `toolName` fields |
| Shared | `src/shared/contracts/sidecar.ts` | Add `AgentActivityEvent` to the sidecar event union, including a stable optional `agentId` |
| Main | `src/main/sidecar/sidecarProcess.ts` | Parse `agent-activity` events from sidecar JSON output |
| Main | `src/main/KopayaAppService.ts` | Map parsed activity events to `SessionEventRecord` and emit via `session-event` |
| Renderer | `src/renderer/App.tsx` | Subscribe to `onSessionEvent` and track live per-agent activity state per session |
| Renderer | `src/renderer/components/ChatPane.tsx` | Render an activity row for each agent while a session is running |
| Renderer | `src/renderer/lib/sessionActivity.ts` | Provide pure helpers for per-agent activity-state updates and display text |
| Sidecar | `sidecar/src/Kopaya.AgentHost/Contracts/ProtocolModels.cs` | Define `AgentActivityEventDto`, including `agentId` |
| Sidecar | `sidecar/src/Kopaya.AgentHost/Services/CopilotWorkflowRunner.cs` | Emit `agent-activity` events during MAF turn execution when observable |
| Sidecar | `sidecar/src/Kopaya.AgentHost/Services/SidecarProtocolHost.cs` | Forward activity events over the stdio protocol |
