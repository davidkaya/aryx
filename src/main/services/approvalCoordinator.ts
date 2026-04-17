import type {
  ApprovalRequestedEvent,
  ExitPlanModeRequestedEvent,
  McpOauthRequiredEvent,
  UserInputRequestedEvent,
} from '@shared/contracts/sidecar';
import {
  dequeuePendingApprovalState,
  enqueuePendingApprovalState,
  getPendingApprovalToolKey,
  listPendingApprovals,
  resolvePendingApproval,
  type ApprovalDecision,
  type PendingApprovalRecord,
} from '@shared/domain/approval';
import type { SessionRecord } from '@shared/domain/session';
import type { SessionEventRecord } from '@shared/domain/event';
import type { SessionRunRecord } from '@shared/domain/runTimeline';
import type { WorkspaceState } from '@shared/domain/workspace';
import { nowIso } from '@shared/utils/ids';

type PendingApprovalHandle = {
  sessionId: string;
  requestId: string;
  resolve: (decision: ApprovalDecision, alwaysApprove?: boolean) => void | Promise<void>;
};

type PendingUserInputHandle = {
  sessionId: string;
  requestId: string;
  resolve: (answer: string, wasFreeform: boolean) => void | Promise<void>;
};

type ApprovalCoordinatorDeps = {
  requireSession: (workspace: WorkspaceState, sessionId: string) => SessionRecord;
  persistWorkspace: (workspace: WorkspaceState) => Promise<WorkspaceState>;
  updateSessionRun: (
    session: SessionRecord,
    requestId: string,
    updater: (run: SessionRunRecord) => SessionRunRecord,
  ) => SessionRunRecord | undefined;
  emitRunUpdated: (sessionId: string, occurredAt: string, run: SessionRunRecord) => void;
  emitSessionEvent: (event: SessionEventRecord) => void;
  failSessionRunRecord: (run: SessionRunRecord, failedAt: string, error: string) => SessionRunRecord;
  upsertRunApprovalEvent: (
    run: SessionRunRecord,
    approval: PendingApprovalRecord,
  ) => SessionRunRecord;
};

export class ApprovalCoordinator {
  readonly pendingApprovalHandles = new Map<string, PendingApprovalHandle>();

  readonly pendingUserInputHandles = new Map<string, PendingUserInputHandle>();

  private readonly requireSession: ApprovalCoordinatorDeps['requireSession'];

  private readonly persistWorkspace: ApprovalCoordinatorDeps['persistWorkspace'];

  private readonly updateSessionRun: ApprovalCoordinatorDeps['updateSessionRun'];

  private readonly emitRunUpdated: ApprovalCoordinatorDeps['emitRunUpdated'];

  private readonly emitSessionEvent: ApprovalCoordinatorDeps['emitSessionEvent'];

  private readonly failSessionRunRecord: ApprovalCoordinatorDeps['failSessionRunRecord'];

  private readonly upsertRunApprovalEvent: ApprovalCoordinatorDeps['upsertRunApprovalEvent'];

  constructor(deps: ApprovalCoordinatorDeps) {
    this.requireSession = deps.requireSession;
    this.persistWorkspace = deps.persistWorkspace;
    this.updateSessionRun = deps.updateSessionRun;
    this.emitRunUpdated = deps.emitRunUpdated;
    this.emitSessionEvent = deps.emitSessionEvent;
    this.failSessionRunRecord = deps.failSessionRunRecord;
    this.upsertRunApprovalEvent = deps.upsertRunApprovalEvent;
  }

  async resolveSessionApproval(
    workspace: WorkspaceState,
    sessionId: string,
    approvalId: string,
    decision: ApprovalDecision,
    alwaysApprove?: boolean,
  ): Promise<WorkspaceState> {
    const session = this.requireSession(workspace, sessionId);
    const approval = session.pendingApproval;
    if (!approval || approval.id !== approvalId) {
      const queuedApproval = session.pendingApprovalQueue?.some((candidate) => candidate.id === approvalId);
      if (queuedApproval) {
        throw new Error(
          approval
            ? `Approval "${approvalId}" is queued behind "${approval.id}" for session "${sessionId}". Resolve the active approval first.`
            : `Approval "${approvalId}" is queued but not active for session "${sessionId}".`,
        );
      }

      throw new Error(`Approval "${approvalId}" is not pending for session "${sessionId}".`);
    }

    const handle = this.pendingApprovalHandles.get(approvalId);
    if (!handle || handle.sessionId !== sessionId) {
      throw new Error(`Approval "${approvalId}" is no longer active. Restart the run and try again.`);
    }

    const resolvedAt = nowIso();
    const resolvedApproval = resolvePendingApproval(approval, decision, resolvedAt);
    this.setSessionPendingApprovalState(session, dequeuePendingApprovalState(session, approvalId));
    session.updatedAt = resolvedAt;

    const approvalKey = getPendingApprovalToolKey(approval);
    if (decision === 'approved' && alwaysApprove && approvalKey) {
      const existing = session.approvalSettings?.autoApprovedToolNames ?? [];
      if (!existing.includes(approvalKey)) {
        session.approvalSettings = { autoApprovedToolNames: [...existing, approvalKey] };
      }
    }

    const updatedRun = this.updateSessionRun(session, handle.requestId, (run) =>
      this.upsertRunApprovalEvent(run, resolvedApproval));

    const cascadeHandles: PendingApprovalHandle[] = [];
    if (decision === 'approved' && approvalKey && approval.kind === 'tool-call') {
      for (const queued of listPendingApprovals(session)) {
        if (queued.id === approvalId) {
          continue;
        }

        const queuedKey = getPendingApprovalToolKey(queued);
        if (queuedKey !== approvalKey) {
          continue;
        }

        const queuedHandle = this.pendingApprovalHandles.get(queued.id);
        if (!queuedHandle || queuedHandle.sessionId !== sessionId) {
          continue;
        }

        const cascadeResolved = resolvePendingApproval(queued, 'approved', resolvedAt);
        this.setSessionPendingApprovalState(session, dequeuePendingApprovalState(session, queued.id));
        this.updateSessionRun(session, queuedHandle.requestId, (run) =>
          this.upsertRunApprovalEvent(run, cascadeResolved));
        this.pendingApprovalHandles.delete(queued.id);
        cascadeHandles.push(queuedHandle);
      }
    }

    const result = await this.persistWorkspace(workspace);
    if (updatedRun) {
      this.emitRunUpdated(sessionId, resolvedAt, updatedRun);
    }

    this.pendingApprovalHandles.delete(approvalId);

    try {
      await Promise.resolve(handle.resolve(decision, alwaysApprove));
      for (const cascaded of cascadeHandles) {
        await Promise.resolve(cascaded.resolve('approved', alwaysApprove));
      }
    } catch (error) {
      const failedAt = nowIso();
      this.rejectPendingApprovals(
        session,
        failedAt,
        'Queued approval was cancelled because the run failed before it could resume.',
      );
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      session.updatedAt = failedAt;

      const failedRun = this.updateSessionRun(session, handle.requestId, (run) =>
        this.failSessionRunRecord(run, failedAt, session.lastError ?? 'Unknown error.'));

      this.emitSessionEvent({
        sessionId,
        kind: 'error',
        occurredAt: failedAt,
        error: session.lastError,
      });
      if (failedRun) {
        this.emitRunUpdated(sessionId, failedAt, failedRun);
      }

      await this.persistWorkspace(workspace);
      throw error;
    }

    return result;
  }

  async resolveSessionUserInput(
    workspace: WorkspaceState,
    sessionId: string,
    userInputId: string,
    answer: string,
    wasFreeform: boolean,
  ): Promise<WorkspaceState> {
    const session = this.requireSession(workspace, sessionId);
    const pending = session.pendingUserInput;
    if (!pending || pending.id !== userInputId) {
      throw new Error(`User input "${userInputId}" is not pending for session "${sessionId}".`);
    }

    const handle = this.pendingUserInputHandles.get(userInputId);
    if (!handle || handle.sessionId !== sessionId) {
      throw new Error(`User input "${userInputId}" is no longer active. Restart the run and try again.`);
    }

    const answeredAt = nowIso();
    session.pendingUserInput = {
      ...pending,
      status: 'answered',
      answer,
      answeredAt,
    };
    session.updatedAt = answeredAt;

    const result = await this.persistWorkspace(workspace);
    this.pendingUserInputHandles.delete(userInputId);

    try {
      await Promise.resolve(handle.resolve(answer, wasFreeform));
      session.pendingUserInput = undefined;
      await this.persistWorkspace(workspace);
    } catch (error) {
      session.status = 'error';
      session.lastError = error instanceof Error ? error.message : String(error);
      session.updatedAt = nowIso();

      this.emitSessionEvent({
        sessionId,
        kind: 'error',
        occurredAt: session.updatedAt,
        error: session.lastError,
      });

      await this.persistWorkspace(workspace);
      throw error;
    }

    return result;
  }

  async handleApprovalRequested(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    approval: ApprovalRequestedEvent | PendingApprovalRecord,
    resolve: (decision: ApprovalDecision, alwaysApprove?: boolean) => void | Promise<void>,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const pendingApproval =
      'type' in approval ? this.createPendingApprovalFromSidecarEvent(approval) : approval;

    this.setSessionPendingApprovalState(session, enqueuePendingApprovalState(session, pendingApproval));
    session.updatedAt = pendingApproval.requestedAt;

    const updatedRun = this.updateSessionRun(session, requestId, (run) =>
      this.upsertRunApprovalEvent(run, pendingApproval));

    this.pendingApprovalHandles.set(pendingApproval.id, {
      sessionId,
      requestId,
      resolve,
    });

    await this.persistWorkspace(workspace);
    if (updatedRun) {
      this.emitRunUpdated(sessionId, pendingApproval.requestedAt, updatedRun);
    }
  }

  async handleUserInputRequested(
    workspace: WorkspaceState,
    sessionId: string,
    requestId: string,
    event: UserInputRequestedEvent,
    resolve: (answer: string, wasFreeform: boolean) => void | Promise<void>,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const requestedAt = nowIso();

    session.pendingUserInput = {
      id: event.userInputId,
      status: 'pending',
      agentId: event.agentId,
      agentName: event.agentName,
      question: event.question,
      choices: event.choices,
      allowFreeform: event.allowFreeform ?? true,
      requestedAt,
    };
    session.updatedAt = requestedAt;

    this.pendingUserInputHandles.set(event.userInputId, {
      sessionId,
      requestId,
      resolve,
    });

    await this.persistWorkspace(workspace);
  }

  async handleExitPlanModeRequested(
    workspace: WorkspaceState,
    sessionId: string,
    event: ExitPlanModeRequestedEvent,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const requestedAt = nowIso();

    session.pendingPlanReview = {
      id: event.exitPlanId,
      status: 'pending',
      agentId: event.agentId,
      agentName: event.agentName,
      summary: event.summary,
      planContent: event.planContent,
      actions: event.actions,
      recommendedAction: event.recommendedAction,
      requestedAt,
    };
    session.updatedAt = requestedAt;

    await this.persistWorkspace(workspace);
  }

  async handleMcpOAuthRequired(
    workspace: WorkspaceState,
    sessionId: string,
    event: McpOauthRequiredEvent,
  ): Promise<void> {
    const session = this.requireSession(workspace, sessionId);
    const requestedAt = nowIso();

    session.pendingMcpAuth = {
      id: event.oauthRequestId,
      status: 'pending',
      agentId: event.agentId,
      agentName: event.agentName,
      serverName: event.serverName,
      serverUrl: event.serverUrl,
      staticClientConfig: event.staticClientConfig
        ? { clientId: event.staticClientConfig.clientId, publicClient: event.staticClientConfig.publicClient }
        : undefined,
      requestedAt,
    };
    session.updatedAt = requestedAt;

    await this.persistWorkspace(workspace);
  }

  createPendingApprovalFromSidecarEvent(event: ApprovalRequestedEvent): PendingApprovalRecord {
    return {
      id: event.approvalId,
      kind: event.approvalKind,
      status: 'pending',
      requestedAt: nowIso(),
      agentId: event.agentId,
      agentName: event.agentName,
      toolName: event.toolName,
      permissionKind: event.permissionKind,
      approvalToolKey: event.approvalToolKey,
      title: event.title,
      detail: event.detail,
      permissionDetail: event.permissionDetail,
    };
  }

  setSessionPendingApprovalState(
    session: SessionRecord,
    state: {
      pendingApproval?: PendingApprovalRecord;
      pendingApprovalQueue?: PendingApprovalRecord[];
    },
  ): void {
    session.pendingApproval = state.pendingApproval;
    session.pendingApprovalQueue = state.pendingApprovalQueue;
  }

  rejectPendingApprovals(
    session: SessionRecord,
    failedAt: string,
    error: string,
  ): string[] {
    const requestIds = new Set<string>();

    for (const pendingApproval of listPendingApprovals(session)) {
      const requestId = this.findApprovalRequestId(session, pendingApproval.id);
      const rejectedApproval = resolvePendingApproval(pendingApproval, 'rejected', failedAt, error);

      if (requestId) {
        requestIds.add(requestId);
        this.updateSessionRun(session, requestId, (run) =>
          this.upsertRunApprovalEvent(run, rejectedApproval));
      }

      this.pendingApprovalHandles.delete(pendingApproval.id);
    }

    this.setSessionPendingApprovalState(session, {});
    return [...requestIds];
  }

  findApprovalRequestId(session: SessionRecord, approvalId: string): string | undefined {
    const matchingRun = session.runs.find((run) =>
      run.events.some((event) => event.kind === 'approval' && event.approvalId === approvalId));
    if (matchingRun) {
      return matchingRun.requestId;
    }

    return session.runs.find((run) => run.status === 'running')?.requestId;
  }
}
