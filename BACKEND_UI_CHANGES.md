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

One important runtime nuance is that MAF / Copilot executor identifiers are not always the raw configured agent IDs. Real streams can emit composite values such as `Architect_agent_concurrent_architect` or generic names such as `assistant`. The sidecar therefore normalizes these runtime identifiers back to the configured pattern agents before emitting `agent-activity` events or choosing the visible author name. This is especially important in handoff flows, where the target agent can continue emitting generic `assistant` updates after control transfer; the sidecar now carries the handed-off identity forward so those updates and final messages still belong to the real target agent.

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

`App.tsx` now subscribes to `onSessionEvent`, applies message-delta / message-complete updates into renderer workspace state so assistant responses can stream live, and tracks live activity per agent for the selected session. `ChatPane.tsx` uses that state to show a status row for each agent while the run is active.

- "Code Reviewer is thinking…"
- "Code Reviewer is using read_file…"
- "Handing off to Summarizer…"

The activity panel in `ChatPane.tsx` is now wired to this data, showing every agent in the pattern with observed activity such as thinking, tool usage, handoff, or completed. If no event has been observed for an agent yet, the UI states that no status has been reported instead of inventing a synthetic state. The panel also keeps the last observed statuses visible after a run completes, and resets them when the next run begins. Completed activity is emitted when final messages are applied, so the status no longer jumps to `Completed` before the corresponding response becomes visible.

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
