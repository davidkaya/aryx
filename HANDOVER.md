# Approval checkpoints frontend handover

## What is implemented in the backend

The backend now supports approval checkpoints in two places:

1. `tool-call`
2. `final-response`

`tool-call` approvals are enforced inside the .NET sidecar through the Copilot permission callback.

`final-response` approvals are enforced in the Electron main process after the sidecar finishes generating assistant messages but before those messages are published into the session transcript.

The roadmap item **"pause before handing off outside the original working set"** is **not implemented** in this change. There is still no working-set model in the backend that can support that rule correctly.

## Important behavioral semantics

- A session **stays** `status: 'running'` while waiting for approval.
- The backend exposes the paused state through `session.pendingApproval`.
- The frontend should treat `session.pendingApproval` as "awaiting approval" even though `session.status` is still `running`.
- Resolving an approval clears `session.pendingApproval`.
- Approving a checkpoint resumes the run.
- Rejecting a `final-response` checkpoint causes the run to fail with an explicit error after the backend resumes the waiting flow.
- Rejecting a `tool-call` checkpoint sends a denial back to the Copilot runtime. The eventual run outcome depends on the runtime response, but it should be treated as a rejected risky action.
- If Eryx restarts while an approval is pending, the backend marks that session as errored and converts the pending approval into a rejected/interrupted run event.

## New shared model shapes

### Pattern approval policy

File: `src/shared/domain/approval.ts`

Patterns can now carry an optional `approvalPolicy`:

```ts
type ApprovalCheckpointKind = 'tool-call' | 'final-response';

interface ApprovalCheckpointRule {
  kind: ApprovalCheckpointKind;
  agentIds?: string[]; // omitted or empty = all agents in the pattern
}

interface ApprovalPolicy {
  rules: ApprovalCheckpointRule[];
}
```

This is attached to `PatternDefinition` as:

```ts
approvalPolicy?: ApprovalPolicy;
```

Backend validation already rejects agent IDs that do not exist in the pattern.

### Session pending approval

File: `src/shared/domain/approval.ts`

Sessions can now expose a single active pending approval:

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

This is attached to `SessionRecord` as:

```ts
pendingApproval?: PendingApprovalRecord;
```

For `final-response`, `pendingApproval.messages` contains the unpublished assistant output that the reviewer should inspect before publication.

For `tool-call`, `pendingApproval.messages` is typically absent.

### Run timeline event

File: `src/shared/domain/runTimeline.ts`

There is a new run timeline event kind:

```ts
kind: 'approval'
```

The event is updated in place over time rather than creating separate requested/approved/rejected entries.

Relevant fields:

```ts
approvalId?: string;
approvalKind?: 'tool-call' | 'final-response';
approvalTitle?: string;
approvalDetail?: string;
permissionKind?: string;
decision?: 'approved' | 'rejected';
status: 'running' | 'completed' | 'error';
```

Interpretation:

- `status: 'running'` => approval requested and still pending
- `status: 'completed'` + `decision: 'approved'` => approval granted
- `status: 'error'` + `decision: 'rejected'` => approval rejected

## New IPC surface

Files:

- `src/shared/contracts/ipc.ts`
- `src/shared/contracts/channels.ts`
- `src/preload/index.ts`
- `src/main/ipc/registerIpcHandlers.ts`

New preload/API call:

```ts
resolveSessionApproval({
  sessionId: string;
  approvalId: string;
  decision: 'approved' | 'rejected';
}): Promise<WorkspaceState>
```

This is the frontend action to approve or reject the active checkpoint.

## Internal sidecar protocol additions

These are backend-only, but useful context for debugging:

Files:

- `src/shared/contracts/sidecar.ts`
- `sidecar/src/Eryx.AgentHost/Contracts/ProtocolModels.cs`
- `sidecar/src/Eryx.AgentHost/Services/SidecarProtocolHost.cs`
- `sidecar/src/Eryx.AgentHost/Services/CopilotWorkflowRunner.cs`

New sidecar event:

```ts
type: 'approval-requested'
```

New sidecar command:

```ts
type: 'resolve-approval'
```

The Electron main process already handles this handshake. The frontend should not talk to the sidecar directly.

## Files that already understand approval data

Backend and shared code:

- `src/shared/domain/approval.ts`
- `src/shared/domain/pattern.ts`
- `src/shared/domain/session.ts`
- `src/shared/domain/runTimeline.ts`
- `src/main/EryxAppService.ts`
- `src/main/sidecar/sidecarProcess.ts`

Minimal renderer compile-support only:

- `src/renderer/lib/runTimelineFormatting.ts`
- `src/renderer/components/RunTimeline.tsx`

Those renderer changes are intentionally minimal. They only keep the current app build/typecheck working with the new timeline event kind.

## Frontend work still needed

### 1. Pattern editor support for approval policy

Files to inspect:

- `src/renderer/components/PatternEditor.tsx`
- `src/renderer/App.tsx`

Needed UI:

- Allow enabling `tool-call` approvals.
- Allow enabling `final-response` approvals.
- Allow scoping each checkpoint to:
  - all agents
  - selected agents

Recommended representation:

- one section named "Approval checkpoints"
- one row per checkpoint kind
- a toggle
- an "all agents / selected agents" selector
- multi-select agent chips when scoped

### 2. Pending approval UI in chat/session surfaces

Files to inspect:

- `src/renderer/components/ChatPane.tsx`
- `src/renderer/components/ActivityPanel.tsx`
- `src/renderer/components/Sidebar.tsx`
- `src/renderer/lib/sessionWorkspace.ts`

Needed behavior:

- Show a visible checkpoint card/banner whenever `session.pendingApproval` exists.
- Present:
  - title
  - detail
  - agent name
  - permission kind (for tool-call)
  - preview messages (for final-response)
- Add **Approve** and **Reject** actions that call `api.resolveSessionApproval(...)`.

### 3. Final-response review UI

Use `session.pendingApproval.messages` when `kind === 'final-response'`.

Recommended UX:

- Render the candidate assistant messages exactly as they would appear in chat.
- Make it clear they are pending publication, not yet committed to transcript history.
- On approval, let the backend publish them.
- On rejection, expect the run to fail and show an error state after the backend resumes the blocked flow.

### 4. Run timeline UI

Files to inspect:

- `src/renderer/components/RunTimeline.tsx`
- `src/renderer/lib/runTimelineFormatting.ts`

Needed improvements:

- Add a dedicated approval event treatment instead of the current minimal fallback.
- Show distinct visuals for:
  - requested
  - approved
  - rejected
- Include checkpoint kind and detail text.
- Include message preview affordances for final-response if desired.

### 5. Session activity / status treatment

Files to inspect:

- `src/renderer/lib/sessionActivity.ts`
- `src/renderer/components/ActivityPanel.tsx`
- `src/renderer/components/ChatPane.tsx`

Important rule:

- Do **not** rely on `session.status` alone to decide whether the session is actively streaming versus blocked on approval.
- Use `session.pendingApproval` as the signal for "paused awaiting human action."

### 6. Error / stale checkpoint handling

The frontend should handle two backend-produced edge cases cleanly:

1. `resolveSessionApproval(...)` can fail if the approval is no longer active.
2. A pending approval can disappear on reload because the backend converted it into an interrupted error after restart.

Recommended UX:

- show a toast or inline error if approval resolution fails
- refresh from workspace state afterward
- show the session error banner when the run has been interrupted

## Suggested frontend implementation order

1. Add read-only pending approval banner/card in `ChatPane`.
2. Wire approve/reject buttons to `resolveSessionApproval`.
3. Render final-response preview from `pendingApproval.messages`.
4. Add timeline rendering for `approval` events.
5. Add pattern editor controls for configuring `approvalPolicy`.
6. Refine sidebar/activity badges for "awaiting approval" state.

## Validation commands

Backend changes already pass:

- `bun run typecheck`
- `bun test`
- `bun run sidecar:test`
- `bun run build`

After the frontend agent finishes, rerun the same four commands.
