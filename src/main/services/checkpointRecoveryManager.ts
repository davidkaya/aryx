import { rm } from 'node:fs/promises';

import type {
  AgentActivityEvent,
  ApprovalRequestedEvent,
  ExitPlanModeRequestedEvent,
  McpOauthRequiredEvent,
  MessageReclassifiedEvent,
  RunTurnCommand,
  UserInputRequestedEvent,
  TurnDeltaEvent,
  WorkflowCheckpointResume,
  WorkflowCheckpointSavedEvent,
} from '@shared/contracts/sidecar';
import type { ChatMessageRecord, SessionRecord } from '@shared/domain/session';
import type { SessionRunRecord } from '@shared/domain/runTimeline';
import { nowIso } from '@shared/utils/ids';

import type { TurnScopedEvent } from '@main/sidecar/runTurnPending';

export type PendingApprovalHandleLike = {
  sessionId: string;
  requestId: string;
};

export type PendingUserInputHandleLike = {
  sessionId: string;
  requestId: string;
};

export type WorkflowCheckpointRecoveryState = {
  workflowSessionId: string;
  checkpointId: string;
  storePath: string;
  stepNumber: number;
  sessionMessages: ChatMessageRecord[];
  runEvents: import('@shared/domain/runTimeline').RunTimelineEventRecord[];
};

type CheckpointRecoveryManagerDeps = {
  persistWorkspace: (workspace: import('@shared/domain/workspace').WorkspaceState) => Promise<void>;
  emitRunUpdated: (sessionId: string, occurredAt: string, run: SessionRunRecord) => void;
  updateSessionRun: (
    session: SessionRecord,
    requestId: string,
    updater: (run: SessionRunRecord) => SessionRunRecord,
  ) => SessionRunRecord | undefined;
  setSessionPendingApprovalState: (
    session: SessionRecord,
    state: {
      pendingApproval?: import('@shared/domain/approval').PendingApprovalRecord;
      pendingApprovalQueue?: import('@shared/domain/approval').PendingApprovalRecord[];
    },
  ) => void;
  pendingApprovalHandles: Map<string, PendingApprovalHandleLike>;
  pendingUserInputHandles: Map<string, PendingUserInputHandleLike>;
};

export class CheckpointRecoveryManager {
  readonly recoveries = new Map<string, WorkflowCheckpointRecoveryState>();

  private readonly persistWorkspace: (workspace: import('@shared/domain/workspace').WorkspaceState) => Promise<void>;
  private readonly emitRunUpdated: (sessionId: string, occurredAt: string, run: SessionRunRecord) => void;
  private readonly updateSessionRun: CheckpointRecoveryManagerDeps['updateSessionRun'];
  private readonly setSessionPendingApprovalState: CheckpointRecoveryManagerDeps['setSessionPendingApprovalState'];
  private readonly pendingApprovalHandles: Map<string, PendingApprovalHandleLike>;
  private readonly pendingUserInputHandles: Map<string, PendingUserInputHandleLike>;

  constructor(deps: CheckpointRecoveryManagerDeps) {
    this.persistWorkspace = deps.persistWorkspace;
    this.emitRunUpdated = deps.emitRunUpdated;
    this.updateSessionRun = deps.updateSessionRun;
    this.setSessionPendingApprovalState = deps.setSessionPendingApprovalState;
    this.pendingApprovalHandles = deps.pendingApprovalHandles;
    this.pendingUserInputHandles = deps.pendingUserInputHandles;
  }

  async runSidecarTurnWithCheckpointRecovery(
    workspace: import('@shared/domain/workspace').WorkspaceState,
    session: SessionRecord,
    requestId: string,
    invokeTurn: (resumeFromCheckpoint?: WorkflowCheckpointResume) => Promise<ChatMessageRecord[]>,
    isUnexpectedSidecarTerminationError: (error: unknown) => boolean,
  ): Promise<ChatMessageRecord[]> {
    try {
      return await invokeTurn();
    } catch (error) {
      const recovery = this.recoveries.get(requestId);
      if (!isUnexpectedSidecarTerminationError(error) || !recovery) {
        throw error;
      }

      const restoredRun = this.restoreWorkflowCheckpointRecovery(session, requestId, recovery);
      await this.persistWorkspace(workspace);
      if (restoredRun) {
        this.emitRunUpdated(session.id, session.updatedAt, restoredRun);
      }

      return invokeTurn({
        workflowSessionId: recovery.workflowSessionId,
        checkpointId: recovery.checkpointId,
        storePath: recovery.storePath,
      });
    }
  }

  recordWorkflowCheckpointRecovery(
    session: SessionRecord,
    run: SessionRunRecord,
    event: WorkflowCheckpointSavedEvent,
  ): void {
    this.recoveries.set(event.requestId, {
      workflowSessionId: event.workflowSessionId,
      checkpointId: event.checkpointId,
      storePath: event.storePath,
      stepNumber: event.stepNumber,
      sessionMessages: structuredClone(session.messages),
      runEvents: structuredClone(run.events),
    });
  }

  restoreWorkflowCheckpointRecovery(
    session: SessionRecord,
    requestId: string,
    recovery: WorkflowCheckpointRecoveryState,
  ): SessionRunRecord | undefined {
    session.messages = structuredClone(recovery.sessionMessages);
    session.status = 'running';
    session.lastError = undefined;
    session.updatedAt = nowIso();
    this.clearPendingRunState(session, requestId);

    return this.updateSessionRun(session, requestId, (run) => ({
      ...run,
      events: structuredClone(recovery.runEvents),
    }));
  }

  clearPendingRunState(session: SessionRecord, requestId: string): void {
    this.setSessionPendingApprovalState(session, {});
    session.pendingUserInput = undefined;
    session.pendingPlanReview = undefined;
    session.pendingMcpAuth = undefined;

    for (const [approvalId, handle] of this.pendingApprovalHandles.entries()) {
      if (handle.sessionId === session.id && handle.requestId === requestId) {
        this.pendingApprovalHandles.delete(approvalId);
      }
    }

    for (const [userInputId, handle] of this.pendingUserInputHandles.entries()) {
      if (handle.sessionId === session.id && handle.requestId === requestId) {
        this.pendingUserInputHandles.delete(userInputId);
      }
    }
  }

  async cleanupWorkflowCheckpointRecovery(requestId: string): Promise<void> {
    const recovery = this.recoveries.get(requestId);
    this.recoveries.delete(requestId);
    if (!recovery) {
      return;
    }

    try {
      await rm(recovery.storePath, { recursive: true, force: true });
    } catch (error) {
      console.warn('[aryx workflow-checkpoint] Failed to clean checkpoint store:', error);
    }
  }
}
