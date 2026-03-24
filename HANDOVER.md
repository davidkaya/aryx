# Approval checkpoints UX handover

## What changed in the backend

Approval checkpoints are now **queued per session** instead of failing when a second approval request arrives before the first one is resolved.

This fixes the previous backend limitation where multi-agent patterns such as `Sequential Trio Review` could throw:

```text
Session "<id>" already has a pending approval.
```

The queue is backend-only in this change. The current frontend can keep working because the active approval is still exposed through the existing `session.pendingApproval` field.

## Queue semantics

- A session still exposes **one active approval** through `session.pendingApproval`.
- Additional approvals waiting behind it are exposed through `session.pendingApprovalQueue`.
- `session.pendingApprovalQueue` does **not** include the active approval.
- Queue order is the order in which approvals were requested.
- `resolveSessionApproval(...)` still resolves **only the active approval**.
- When the active approval is resolved, the next queued approval automatically becomes the new `session.pendingApproval`.
- If the run fails while approvals remain queued, the backend rejects and clears the remaining queued approvals.
- If Eryx restarts while approvals are pending or queued, the backend rejects all of them and marks the session/run as errored.

## Current shared model

### Pattern approval policy

This is unchanged from the earlier backend work:

```ts
type ApprovalCheckpointKind = 'tool-call' | 'final-response';

interface ApprovalCheckpointRule {
  kind: ApprovalCheckpointKind;
  agentIds?: string[]; // omitted or empty = all agents
}

interface ApprovalPolicy {
  rules: ApprovalCheckpointRule[];
}
```

### Session approval state

The active approval + queued approvals are now represented as:

```ts
interface PendingApprovalMessageRecord {
  id: string;
  authorName: string;
  content: string;
}

interface PendingApprovalRecord {
  id: string;
  kind: 'tool-call' | 'final-response';
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  resolvedAt?: string;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  permissionKind?: string;
  title: string;
  detail?: string;
  messages?: PendingApprovalMessageRecord[];
}
```

Attached to `SessionRecord` as:

```ts
pendingApproval?: PendingApprovalRecord;
pendingApprovalQueue?: PendingApprovalRecord[];
```

Interpretation:

- `pendingApproval` = the approval the user can act on **right now**
- `pendingApprovalQueue` = additional pending approvals waiting behind it

For `final-response`, `pendingApproval.messages` contains the unpublished assistant output preview.

For `tool-call`, `messages` is usually absent and the useful context is `agentName`, `toolName`, and `permissionKind`.

## IPC surface

No new IPC was added for queueing.

The renderer still resolves approvals through:

```ts
resolveSessionApproval({
  sessionId: string;
  approvalId: string;
  decision: 'approved' | 'rejected';
}): Promise<WorkspaceState>
```

Important behavior:

- this resolves the **active** approval only
- if the user somehow attempts to resolve a queued approval directly, the backend rejects it
- after a successful resolution, the next queued approval may immediately become active in the returned workspace state

## Timeline behavior

The run timeline still uses `approval` events.

Each approval request gets its own event keyed by `approvalId`.

That means queued approvals now show up as multiple `approval` events in the same run when applicable. The active/queued distinction is in session state, not in the timeline event type.

## Backend files changed for queue support

- `src/shared/domain/approval.ts`
  - added queue-state helpers and normalization
- `src/shared/domain/session.ts`
  - added `pendingApprovalQueue`
- `src/shared/domain/sessionLibrary.ts`
  - duplicated sessions now clear queued approvals too
- `src/main/persistence/workspaceRepository.ts`
  - normalizes legacy single-approval data into active + queue state
- `src/main/EryxAppService.ts`
  - enqueues approval requests instead of throwing
  - advances the queue on resolution
  - rejects all queued approvals on restart / failure cleanup

## What the current frontend already does

The current UI should remain functionally compatible because it already reads `session.pendingApproval` and renders a single active approval banner/card.

That means:

- users can still resolve approvals one at a time
- the next queued approval should appear automatically after resolving the current one
- no urgent UI fix is required just to keep the app working

## Next UX steps for the frontend agent

These are the next improvements the UX agent should make on top of the new backend queue.

### 1. Show queue size next to the active approval

Files to inspect:

- `src/renderer/components/ChatPane.tsx`
- `src/renderer/components/ActivityPanel.tsx`
- `src/renderer/components/Sidebar.tsx`

Recommended UX:

- if `session.pendingApprovalQueue?.length > 0`, show a compact badge like:
  - `1 queued`
  - `2 queued`
- keep the active approval clearly distinguished from queued approvals

### 2. Clarify that the visible approval is only the active one

In the active approval card/banner, add copy such as:

- `Approval 1 of 3`
- `Next approval will appear after this one is resolved`

This will make automatic queue advancement feel intentional instead of surprising.

### 3. Add an optional queued-approvals preview

Files to inspect:

- `src/renderer/components/ChatPane.tsx`
- `src/renderer/components/ActivityPanel.tsx`

Recommended UX:

- an accordion or compact list for `session.pendingApprovalQueue`
- each queued item can show:
  - title
  - kind
  - agent name
  - permission kind / tool name when available

Important:

- queued approvals are **read-only**
- only the active `pendingApproval` should show Approve / Reject buttons

### 4. Handle queue transitions smoothly

When the active approval is resolved and the next one becomes active:

- avoid jarring layout jumps
- keep scroll position stable
- consider a subtle transition so the user understands the queue advanced

### 5. Improve error copy for queued-approval edge cases

Possible backend outcomes the UI should explain well:

- active approval was resolved, then the run failed before the queue fully drained
- app restarted and the whole queue was rejected/interrupted
- user tried to resolve an approval that is no longer active

Recommended UX:

- inline error or toast
- refresh from returned workspace state
- preserve visibility into which approval is now active

### 6. Optionally surface queue state in the timeline

The timeline already records all approval events, but the UI could add:

- an “active” vs “queued” distinction when an approval event is still pending
- badges or copy that explain multiple approval checkpoints exist in the same run

This is optional because the core queue behavior is already represented in backend state.

## Validation commands

Backend queue changes should be validated with:

- `bun run typecheck`
- `bun test`
- `bun run sidecar:test`
- `bun run build`
