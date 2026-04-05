import electron from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type {
  AgentActivityEvent,
  ApprovalRequestedEvent,
  CancelTurnCommand,
  SidecarCommand,
  SidecarCapabilities,
  SidecarEvent,
  TurnDeltaEvent,
  MessageReclassifiedEvent,
  UserInputRequestedEvent,
  McpOauthRequiredEvent,
  ExitPlanModeRequestedEvent,
  ValidatePatternCommand,
  ValidateWorkflowCommand,
  RunTurnCommand,
  CopilotSessionListFilter,
  CopilotSessionInfo,
  QuotaSnapshot,
} from '@shared/contracts/sidecar';
import type { ApprovalDecision } from '@shared/domain/approval';
import type { ChatMessageRecord } from '@shared/domain/session';
import { createSidecarEnvironment } from '@main/sidecar/sidecarEnvironment';
import {
  markRunTurnPendingErrored,
  shouldHandleRunTurnEvent,
  type RunTurnPendingCommand,
  type TurnScopedEvent,
} from '@main/sidecar/runTurnPending';
import { TurnCancelledError } from '@main/sidecar/turnCancelledError';
import { resolveSidecarProcess } from '@main/sidecar/sidecarRuntime';

const { app } = electron;

type PendingCommand =
  | ({
      processId: number;
      kind: 'capabilities';
      resolve: (capabilities: SidecarCapabilities) => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'validate-pattern';
      resolve: (issues: ValidatePatternCommand['pattern'] extends never ? never : unknown) => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'validate-workflow';
      resolve: (issues: ValidateWorkflowCommand['workflow'] extends never ? never : unknown) => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'resolve-approval';
      resolve: () => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'resolve-user-input';
      resolve: () => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'cancel-turn';
      resolve: () => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'list-sessions';
      resolve: (sessions: CopilotSessionInfo[]) => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'delete-session';
      resolve: (sessions: CopilotSessionInfo[]) => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'disconnect-session';
      resolve: () => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
      kind: 'get-quota';
      resolve: (snapshots: Record<string, QuotaSnapshot>) => void;
      reject: (error: Error) => void;
    })
  | ({
      processId: number;
    } & RunTurnPendingCommand);

type ManagedSidecarProcess = {
  id: number;
  child: ChildProcessWithoutNullStreams;
  stdoutBuffer: string;
  exitExpected: boolean;
  terminated: boolean;
  closed: Promise<void>;
  resolveClosed: () => void;
};

export const SIDECAR_STOPPED_BEFORE_COMPLETION_MESSAGE =
  'The .NET sidecar was stopped before the command completed.';

export class SidecarClient {
  private processState?: ManagedSidecarProcess;
  private nextProcessId = 0;
  private readonly pending = new Map<string, PendingCommand>();

  async describeCapabilities(): Promise<SidecarCapabilities> {
    const command = await this.dispatch<SidecarCapabilities>({
      type: 'describe-capabilities',
      requestId: `cap-${Date.now()}`,
    });

    return command;
  }

  async validatePattern(pattern: ValidatePatternCommand['pattern']): Promise<unknown> {
    return this.dispatch<unknown>({
      type: 'validate-pattern',
      requestId: `validate-${Date.now()}`,
      pattern,
    });
  }

  async validateWorkflow(
    workflow: ValidateWorkflowCommand['workflow'],
    workflowLibrary?: ValidateWorkflowCommand['workflowLibrary'],
  ): Promise<unknown> {
    return this.dispatch<unknown>({
      type: 'validate-workflow',
      requestId: `validate-workflow-${Date.now()}`,
      workflow,
      workflowLibrary,
    });
  }

  async runTurn(
    command: RunTurnCommand,
    onDelta: (event: TurnDeltaEvent) => void | Promise<void>,
    onActivity: (event: AgentActivityEvent) => void | Promise<void>,
    onApproval: (event: ApprovalRequestedEvent) => void | Promise<void>,
    onUserInput: (event: UserInputRequestedEvent) => void | Promise<void>,
    onMcpOAuthRequired: (event: McpOauthRequiredEvent) => void | Promise<void>,
    onExitPlanMode: (event: ExitPlanModeRequestedEvent) => void | Promise<void>,
    onMessageReclassified: (event: MessageReclassifiedEvent) => void | Promise<void>,
    onTurnScopedEvent: (event: TurnScopedEvent) => void | Promise<void>,
  ): Promise<ChatMessageRecord[]> {
    return this.dispatch<ChatMessageRecord[]>(command, onDelta, onActivity, onApproval, onUserInput, onMcpOAuthRequired, onExitPlanMode, onMessageReclassified, onTurnScopedEvent);
  }

  async resolveUserInput(userInputId: string, answer: string, wasFreeform: boolean): Promise<void> {
    return this.dispatch<void>({
      type: 'resolve-user-input',
      requestId: `user-input-${Date.now()}`,
      userInputId,
      answer,
      wasFreeform,
    });
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision, alwaysApprove?: boolean): Promise<void> {
    return this.dispatch<void>({
      type: 'resolve-approval',
      requestId: `approval-${Date.now()}`,
      approvalId,
      decision,
      alwaysApprove: alwaysApprove ?? false,
    });
  }

  async cancelTurn(targetRequestId: string): Promise<void> {
    return this.dispatch<void>({
      type: 'cancel-turn',
      requestId: `cancel-${Date.now()}`,
      targetRequestId,
    } satisfies CancelTurnCommand);
  }

  async listSessions(filter?: CopilotSessionListFilter): Promise<CopilotSessionInfo[]> {
    return this.dispatch<CopilotSessionInfo[]>({
      type: 'list-sessions',
      requestId: `list-sessions-${Date.now()}`,
      filter,
    });
  }

  async deleteSession(sessionId?: string, copilotSessionId?: string): Promise<CopilotSessionInfo[]> {
    return this.dispatch<CopilotSessionInfo[]>({
      type: 'delete-session',
      requestId: `delete-session-${Date.now()}`,
      sessionId,
      copilotSessionId,
    });
  }

  async disconnectSession(sessionId: string): Promise<void> {
    return this.dispatch<void>({
      type: 'disconnect-session',
      requestId: `disconnect-session-${Date.now()}`,
      sessionId,
    });
  }

  async getQuota(): Promise<Record<string, QuotaSnapshot>> {
    return this.dispatch<Record<string, QuotaSnapshot>>({
      type: 'get-quota',
      requestId: `get-quota-${Date.now()}`,
    });
  }

  async dispose(): Promise<void> {
    const state = this.processState;
    if (!state) {
      return;
    }

    state.exitExpected = true;
    if (!state.child.killed && state.child.exitCode === null) {
      state.child.kill();
    }
    await state.closed;
  }

  private async ensureProcess(): Promise<ManagedSidecarProcess> {
    if (
      this.processState &&
      !this.processState.exitExpected &&
      !this.processState.terminated &&
      this.processState.child.exitCode === null
    ) {
      return this.processState;
    }

    if (this.processState) {
      await this.processState.closed;
    }

    const sidecar = resolveSidecarProcess({
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      platform: process.platform,
    });
    const childProcess = spawn(sidecar.command, sidecar.args, {
      cwd: sidecar.cwd,
      env: createSidecarEnvironment(process.env),
      stdio: 'pipe',
      windowsHide: true,
    });
    let resolveClosed!: () => void;
    const state: ManagedSidecarProcess = {
      id: this.nextProcessId + 1,
      child: childProcess,
      stdoutBuffer: '',
      exitExpected: false,
      terminated: false,
      closed: new Promise<void>((resolve) => {
        resolveClosed = resolve;
      }),
      resolveClosed,
    };
    this.nextProcessId = state.id;
    this.processState = state;

    childProcess.stdout.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: string) => {
      if (state.terminated) {
        return;
      }

      state.stdoutBuffer += chunk;
      this.flushStdoutBuffer(state);
    });

    childProcess.stderr.setEncoding('utf8');
    childProcess.stderr.on('data', (chunk: string) => {
      console.error('[aryx sidecar]', chunk.trim());
    });

    childProcess.on('close', (code) => {
      const error = state.exitExpected
        ? new Error(SIDECAR_STOPPED_BEFORE_COMPLETION_MESSAGE)
        : new Error(`The .NET sidecar exited unexpectedly with code ${code ?? 'unknown'}.`);
      this.handleProcessClosed(state, error);
    });

    return state;
  }

  private async dispatch<TResult>(
    command: SidecarCommand,
    onDelta?: (event: TurnDeltaEvent) => void | Promise<void>,
    onActivity?: (event: AgentActivityEvent) => void | Promise<void>,
    onApproval?: (event: ApprovalRequestedEvent) => void | Promise<void>,
    onUserInput?: (event: UserInputRequestedEvent) => void | Promise<void>,
    onMcpOAuthRequired?: (event: McpOauthRequiredEvent) => void | Promise<void>,
    onExitPlanMode?: (event: ExitPlanModeRequestedEvent) => void | Promise<void>,
    onMessageReclassified?: (event: MessageReclassifiedEvent) => void | Promise<void>,
    onTurnScopedEvent?: (event: TurnScopedEvent) => void | Promise<void>,
  ): Promise<TResult> {
    const state = await this.ensureProcess();

    return new Promise<TResult>((resolve, reject) => {
      if (command.type === 'run-turn') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'run-turn',
          resolve: resolve as (messages: ChatMessageRecord[]) => void,
          reject,
          onDelta: onDelta ?? (() => undefined),
          onActivity: onActivity ?? (() => undefined),
          onApproval: onApproval ?? (() => undefined),
          onUserInput: onUserInput ?? (() => undefined),
          onMcpOAuthRequired: onMcpOAuthRequired ?? (() => undefined),
          onExitPlanMode: onExitPlanMode ?? (() => undefined),
          onMessageReclassified: onMessageReclassified ?? (() => undefined),
          onTurnScopedEvent: onTurnScopedEvent ?? (() => undefined),
          errored: false,
        });
      } else if (command.type === 'validate-pattern') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'validate-pattern',
          resolve: resolve as (issues: unknown) => void,
          reject,
        });
      } else if (command.type === 'validate-workflow') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'validate-workflow',
          resolve: resolve as (issues: unknown) => void,
          reject,
        });
      } else if (command.type === 'resolve-approval') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'resolve-approval',
          resolve: resolve as () => void,
          reject,
        });
      } else if (command.type === 'resolve-user-input') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'resolve-user-input',
          resolve: resolve as () => void,
          reject,
        });
      } else if (command.type === 'cancel-turn') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'cancel-turn',
          resolve: resolve as () => void,
          reject,
        });
      } else if (command.type === 'list-sessions') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'list-sessions',
          resolve: resolve as (sessions: CopilotSessionInfo[]) => void,
          reject,
        });
      } else if (command.type === 'delete-session') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'delete-session',
          resolve: resolve as (sessions: CopilotSessionInfo[]) => void,
          reject,
        });
      } else if (command.type === 'disconnect-session') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'disconnect-session',
          resolve: resolve as () => void,
          reject,
        });
      } else if (command.type === 'get-quota') {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'get-quota',
          resolve: resolve as (snapshots: Record<string, QuotaSnapshot>) => void,
          reject,
        });
      } else {
        this.pending.set(command.requestId, {
          processId: state.id,
          kind: 'capabilities',
          resolve: resolve as (capabilities: SidecarCapabilities) => void,
          reject,
        });
      }

      state.child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  private flushStdoutBuffer(state: ManagedSidecarProcess): void {
    let newlineIndex = state.stdoutBuffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const rawLine = state.stdoutBuffer.slice(0, newlineIndex).trim();
      state.stdoutBuffer = state.stdoutBuffer.slice(newlineIndex + 1);

      if (rawLine) {
        this.handleEvent(state.id, JSON.parse(rawLine) as SidecarEvent);
      }

      newlineIndex = state.stdoutBuffer.indexOf('\n');
    }
  }

  private handleEvent(processId: number, event: SidecarEvent): void {
    const pending = this.pending.get(event.requestId);
    if (!pending || pending.processId !== processId) {
      return;
    }

    switch (event.type) {
      case 'capabilities':
        if (pending.kind === 'capabilities') {
          pending.resolve(event.capabilities);
          this.pending.delete(event.requestId);
        }
        return;
      case 'pattern-validation':
        if (pending.kind === 'validate-pattern') {
          pending.resolve(event.issues);
          this.pending.delete(event.requestId);
        }
        return;
      case 'workflow-validation':
        if (pending.kind === 'validate-workflow') {
          pending.resolve(event.issues);
          this.pending.delete(event.requestId);
        }
        return;
      case 'turn-delta':
        if (pending.kind === 'run-turn' && shouldHandleRunTurnEvent(pending)) {
          this.invokeRunTurnHandler(event.requestId, pending, () => pending.onDelta(event));
        }
        return;
      case 'agent-activity':
        if (pending.kind === 'run-turn' && shouldHandleRunTurnEvent(pending)) {
          this.invokeRunTurnHandler(event.requestId, pending, () => pending.onActivity(event));
        }
        return;
      case 'approval-requested':
        if (pending.kind === 'run-turn' && shouldHandleRunTurnEvent(pending)) {
          this.invokeRunTurnHandler(event.requestId, pending, () => pending.onApproval(event));
        }
        return;
      case 'user-input-requested':
        if (pending.kind === 'run-turn' && shouldHandleRunTurnEvent(pending)) {
          this.invokeRunTurnHandler(event.requestId, pending, () => pending.onUserInput(event));
        }
        return;
      case 'mcp-oauth-required':
        if (pending.kind === 'run-turn' && shouldHandleRunTurnEvent(pending)) {
          this.invokeRunTurnHandler(event.requestId, pending, () => pending.onMcpOAuthRequired(event));
        }
        return;
      case 'exit-plan-mode-requested':
        if (pending.kind === 'run-turn' && shouldHandleRunTurnEvent(pending)) {
          this.invokeRunTurnHandler(event.requestId, pending, () => pending.onExitPlanMode(event));
        }
        return;
      case 'message-reclassified':
        if (pending.kind === 'run-turn' && shouldHandleRunTurnEvent(pending)) {
          this.invokeRunTurnHandler(event.requestId, pending, () => pending.onMessageReclassified(event));
        }
        return;
      case 'subagent-event':
      case 'skill-invoked':
      case 'hook-lifecycle':
      case 'session-usage':
       case 'session-compaction':
       case 'pending-messages-modified':
      case 'workflow-checkpoint-saved':
       case 'workflow-diagnostic':
       case 'assistant-usage':
       case 'assistant-intent':
       case 'reasoning-delta':
        if (pending.kind === 'run-turn' && shouldHandleRunTurnEvent(pending)) {
          this.invokeRunTurnHandler(event.requestId, pending, () => pending.onTurnScopedEvent(event));
        }
        return;
      case 'quota-result':
        if (pending.kind === 'get-quota') {
          pending.resolve(event.quotaSnapshots);
          this.pending.delete(event.requestId);
        }
        return;
      case 'sessions-listed':
        if (pending.kind === 'list-sessions') {
          pending.resolve(event.sessions);
          this.pending.delete(event.requestId);
        }
        return;
      case 'sessions-deleted':
        if (pending.kind === 'delete-session') {
          pending.resolve(event.sessions);
          this.pending.delete(event.requestId);
        }
        return;
      case 'session-disconnected':
        if (pending.kind === 'disconnect-session') {
          pending.resolve();
          this.pending.delete(event.requestId);
        }
        return;
      case 'turn-complete':
        if (pending.kind === 'run-turn') {
          if (shouldHandleRunTurnEvent(pending)) {
            if (event.cancelled) {
              markRunTurnPendingErrored(pending, new TurnCancelledError());
            } else {
              pending.resolve(event.messages);
            }
          }
          this.pending.delete(event.requestId);
        }
        return;
      case 'command-error':
        if (pending.kind === 'run-turn') {
          markRunTurnPendingErrored(pending, new Error(event.message));
        } else {
          pending.reject(new Error(event.message));
        }
        this.pending.delete(event.requestId);
        return;
      case 'command-complete':
        if (pending.kind === 'resolve-approval' || pending.kind === 'resolve-user-input' || pending.kind === 'cancel-turn') {
          pending.resolve();
          this.pending.delete(event.requestId);
        } else if (pending.kind !== 'run-turn' || pending.errored) {
          this.pending.delete(event.requestId);
        }
        return;
    }
  }

  private invokeRunTurnHandler(
    requestId: string,
    pending: RunTurnPendingCommand,
    callback: () => void | Promise<void>,
  ): void {
    void Promise.resolve(callback()).catch((error: unknown) => {
      markRunTurnPendingErrored(pending, error);
      if (this.pending.get(requestId) !== pending) {
        return;
      }
    });
  }

  private handleProcessClosed(state: ManagedSidecarProcess, error: Error): void {
    if (state.terminated) {
      return;
    }

    state.terminated = true;
    if (this.processState === state) {
      this.processState = undefined;
    }

    state.stdoutBuffer = '';
    state.resolveClosed();

    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.processId !== state.id) {
        continue;
      }

      pending.reject(error);
      this.pending.delete(requestId);
    }
  }
}
