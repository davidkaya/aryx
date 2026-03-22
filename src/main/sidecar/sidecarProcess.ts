import { app } from 'electron';
import { once } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type {
  AgentActivityEvent,
  SidecarCapabilities,
  SidecarCommand,
  SidecarEvent,
  TurnDeltaEvent,
  ValidatePatternCommand,
  RunTurnCommand,
} from '@shared/contracts/sidecar';
import type { ChatMessageRecord } from '@shared/domain/session';
import { createSidecarEnvironment } from '@main/sidecar/sidecarEnvironment';
import {
  shouldHandleSidecarExit,
  shouldRestartSidecarOnCapabilityRefresh,
} from '@main/sidecar/sidecarRefresh';
import {
  markRunTurnPendingErrored,
  shouldHandleRunTurnEvent,
  type RunTurnPendingCommand,
} from '@main/sidecar/runTurnPending';
import { resolveSidecarProcess } from '@main/sidecar/sidecarRuntime';

type PendingCommand =
  | {
      kind: 'capabilities';
      resolve: (capabilities: SidecarCapabilities) => void;
      reject: (error: Error) => void;
    }
  | {
      kind: 'validate-pattern';
      resolve: (issues: ValidatePatternCommand['pattern'] extends never ? never : unknown) => void;
      reject: (error: Error) => void;
    }
  | RunTurnPendingCommand;

export class SidecarClient {
  private process?: ChildProcessWithoutNullStreams;
  private stdoutBuffer = '';
  private readonly pending = new Map<string, PendingCommand>();

  async describeCapabilities(): Promise<SidecarCapabilities> {
    const command = await this.dispatch<SidecarCapabilities>({
      type: 'describe-capabilities',
      requestId: `cap-${Date.now()}`,
    });

    return command;
  }

  async refreshCapabilities(): Promise<SidecarCapabilities> {
    if (shouldRestartSidecarOnCapabilityRefresh(this.hasActiveRunTurn())) {
      await this.dispose();
    }

    return this.describeCapabilities();
  }

  async validatePattern(pattern: ValidatePatternCommand['pattern']): Promise<unknown> {
    return this.dispatch<unknown>({
      type: 'validate-pattern',
      requestId: `validate-${Date.now()}`,
      pattern,
    });
  }

  async runTurn(
    command: RunTurnCommand,
    onDelta: (event: TurnDeltaEvent) => void | Promise<void>,
    onActivity: (event: AgentActivityEvent) => void | Promise<void>,
  ): Promise<ChatMessageRecord[]> {
    return this.dispatch<ChatMessageRecord[]>(command, onDelta, onActivity);
  }

  async dispose(): Promise<void> {
    const sidecar = this.process;
    if (!sidecar) {
      return;
    }

    if (sidecar.exitCode !== null || sidecar.signalCode !== null) {
      return;
    }

    const exitPromise = once(sidecar, 'exit');
    sidecar.kill();
    await exitPromise;
  }

  hasActiveRunTurn(): boolean {
    for (const pending of this.pending.values()) {
      if (pending.kind === 'run-turn') {
        return true;
      }
    }

    return false;
  }

  private async ensureProcess(): Promise<ChildProcessWithoutNullStreams> {
    if (this.process && !this.process.killed) {
      return this.process;
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
    this.process = childProcess;

    childProcess.stdout.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      this.flushStdoutBuffer();
    });

    childProcess.stderr.setEncoding('utf8');
    childProcess.stderr.on('data', (chunk: string) => {
      console.error('[kopaya sidecar]', chunk.trim());
    });

    childProcess.on('exit', (code) => {
      if (!shouldHandleSidecarExit(this.process?.pid, childProcess.pid)) {
        return;
      }

      const error = new Error(`The .NET sidecar exited unexpectedly with code ${code ?? 'unknown'}.`);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      this.process = undefined;
      this.stdoutBuffer = '';
    });

    return childProcess;
  }

  private async dispatch<TResult>(
    command: SidecarCommand,
    onDelta?: (event: TurnDeltaEvent) => void | Promise<void>,
    onActivity?: (event: AgentActivityEvent) => void | Promise<void>,
  ): Promise<TResult> {
    const process = await this.ensureProcess();

    return new Promise<TResult>((resolve, reject) => {
      if (command.type === 'run-turn') {
        this.pending.set(command.requestId, {
          kind: 'run-turn',
          resolve: resolve as (messages: ChatMessageRecord[]) => void,
          reject,
          onDelta: onDelta ?? (() => undefined),
          onActivity: onActivity ?? (() => undefined),
          errored: false,
        });
      } else if (command.type === 'validate-pattern') {
        this.pending.set(command.requestId, {
          kind: 'validate-pattern',
          resolve: resolve as (issues: unknown) => void,
          reject,
        });
      } else {
        this.pending.set(command.requestId, {
          kind: 'capabilities',
          resolve: resolve as (capabilities: SidecarCapabilities) => void,
          reject,
        });
      }

      process.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  private flushStdoutBuffer(): void {
    let newlineIndex = this.stdoutBuffer.indexOf('\n');

    while (newlineIndex >= 0) {
      const rawLine = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (rawLine) {
        this.handleEvent(JSON.parse(rawLine) as SidecarEvent);
      }

      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  private handleEvent(event: SidecarEvent): void {
    const pending = this.pending.get(event.requestId);
    if (!pending) {
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
      case 'turn-complete':
        if (pending.kind === 'run-turn') {
          if (shouldHandleRunTurnEvent(pending)) {
            pending.resolve(event.messages);
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
        if (pending.kind !== 'run-turn' || pending.errored) {
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
}
