import { describe, expect, mock, test } from 'bun:test';

import type { PendingApprovalRecord } from '@shared/domain/approval';
import type { PendingMcpAuthRecord } from '@shared/domain/mcpAuth';
import type { PatternDefinition } from '@shared/domain/pattern';
import type { PendingPlanReviewRecord } from '@shared/domain/planReview';
import type { SessionRunRecord } from '@shared/domain/runTimeline';
import type { SessionRecord } from '@shared/domain/session';
import type { PendingUserInputRecord } from '@shared/domain/userInput';
import { createWorkspaceSeed, type WorkspaceState } from '@shared/domain/workspace';

const TIMESTAMP = '2026-03-28T00:00:00.000Z';
const INTERRUPTED_RUN_ERROR =
  'This session was interrupted because Aryx restarted while a run was in progress.';

mock.module('electron', () => {
  const electronMock = {
    app: {
      isPackaged: false,
      getAppPath: () => 'C:\\workspace\\personal\\repositories\\aryx',
      getPath: () => 'C:\\workspace\\personal\\repositories\\aryx\\tests\\fixtures',
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    shell: {
      openPath: async () => '',
    },
  };

  return {
    ...electronMock,
    default: electronMock,
  };
});

mock.module('keytar', () => ({
  default: {
    getPassword: async () => null,
    setPassword: async () => undefined,
    deletePassword: async () => false,
  },
}));

const { AryxAppService } = await import('@main/AryxAppService');

function requireSinglePattern(workspace: WorkspaceState): PatternDefinition {
  const pattern = workspace.patterns.find((candidate) => candidate.mode === 'single');
  if (!pattern) {
    throw new Error('Expected the workspace seed to include a single-agent pattern.');
  }

  return pattern;
}

function createSession(patternId: string, overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-1',
    projectId: 'project-1',
    patternId,
    title: 'Session',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    status: 'idle',
    messages: [],
    runs: [],
    ...overrides,
  };
}

function createRun(
  pattern: PatternDefinition,
  overrides?: Partial<SessionRunRecord>,
): SessionRunRecord {
  return {
    id: 'run-1',
    requestId: 'request-1',
    projectId: 'project-1',
    projectPath: 'C:\\workspace\\personal\\repositories\\aryx',
    workspaceKind: 'project',
    patternId: pattern.id,
    patternName: pattern.name,
    patternMode: pattern.mode,
    triggerMessageId: 'message-1',
    startedAt: TIMESTAMP,
    status: 'running',
    agents: [],
    events: [
      {
        id: 'run-event-1',
        kind: 'run-started',
        occurredAt: TIMESTAMP,
        status: 'completed',
      },
    ],
    ...overrides,
  };
}

function createPendingApproval(id: string, title: string): PendingApprovalRecord {
  return {
    id,
    kind: 'tool-call',
    status: 'pending',
    requestedAt: TIMESTAMP,
    title,
  };
}

function createPendingUserInput(overrides?: Partial<PendingUserInputRecord>): PendingUserInputRecord {
  return {
    id: 'user-input-1',
    status: 'pending',
    question: 'What should I do next?',
    allowFreeform: true,
    requestedAt: TIMESTAMP,
    ...overrides,
  };
}

function createPendingPlanReview(overrides?: Partial<PendingPlanReviewRecord>): PendingPlanReviewRecord {
  return {
    id: 'plan-review-1',
    status: 'pending',
    summary: 'Review the plan before continuing.',
    planContent: '1. Investigate\n2. Implement',
    requestedAt: TIMESTAMP,
    ...overrides,
  };
}

function createPendingMcpAuth(overrides?: Partial<PendingMcpAuthRecord>): PendingMcpAuthRecord {
  return {
    id: 'oauth-1',
    status: 'pending',
    serverName: 'Example MCP',
    serverUrl: 'https://example.com/mcp',
    requestedAt: TIMESTAMP,
    ...overrides,
  };
}

function createService(
  workspace: WorkspaceState,
): {
  service: InstanceType<typeof AryxAppService>;
  getSaveCalls: () => number;
} {
  let saveCalls = 0;
  const service = new AryxAppService();
  const internals = service as unknown as Record<string, unknown>;

  internals.workspaceRepository = {
    load: async () => workspace,
    save: async () => {
      saveCalls += 1;
    },
  };
  internals.syncUserDiscoveredTooling = async () => false;
  internals.syncProjectDiscoveredTooling = async () => false;
  internals.pruneUnavailableSessionToolingSelections = () => false;
  internals.pruneUnavailableApprovalTools = async () => false;
  internals.refreshProjectGitContext = async () => undefined;

  return {
    service,
    getSaveCalls: () => saveCalls,
  };
}

describe('AryxAppService interrupted session cleanup', () => {
  test('clears stale approvals and user input, then fails the interrupted run on load', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requireSinglePattern(workspace);
    const runningRun = createRun(pattern);
    const session = createSession(pattern.id, {
      status: 'running',
      pendingApproval: createPendingApproval('approval-1', 'Approve reading the repo'),
      pendingApprovalQueue: [createPendingApproval('approval-2', 'Approve writing the repo')],
      pendingUserInput: createPendingUserInput(),
      runs: [runningRun],
    });
    workspace.sessions = [session];

    const { service, getSaveCalls } = createService(workspace);

    const loaded = await service.loadWorkspace();
    const cleanedSession = loaded.sessions[0];
    if (!cleanedSession) {
      throw new Error('Expected loadWorkspace to return the interrupted session.');
    }

    expect(cleanedSession.pendingApproval).toBeUndefined();
    expect(cleanedSession.pendingApprovalQueue).toBeUndefined();
    expect(cleanedSession.pendingUserInput).toBeUndefined();
    expect(cleanedSession.status).toBe('error');
    expect(cleanedSession.lastError).toBe(INTERRUPTED_RUN_ERROR);
    expect(getSaveCalls()).toBe(1);

    const failedRun = cleanedSession.runs[0];
    if (!failedRun) {
      throw new Error('Expected the interrupted run to remain attached to the session.');
    }

    expect(failedRun.status).toBe('error');
    expect(failedRun.completedAt).toBe(cleanedSession.updatedAt);
    expect(failedRun.events.some((event) => event.kind === 'run-failed' && event.error === INTERRUPTED_RUN_ERROR))
      .toBe(true);
    expect(failedRun.events.filter((event) => event.kind === 'approval').map((event) => event.decision))
      .toEqual(['rejected', 'rejected']);
  });

  test('fails sessions that were left in running state even without pending interaction records', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requireSinglePattern(workspace);
    const session = createSession(pattern.id, {
      status: 'running',
      runs: [createRun(pattern)],
    });
    workspace.sessions = [session];

    const { service, getSaveCalls } = createService(workspace);

    const loaded = await service.loadWorkspace();
    const cleanedSession = loaded.sessions[0];
    if (!cleanedSession) {
      throw new Error('Expected loadWorkspace to return the running session.');
    }

    expect(cleanedSession.status).toBe('error');
    expect(cleanedSession.lastError).toBe(INTERRUPTED_RUN_ERROR);
    expect(cleanedSession.runs[0]?.status).toBe('error');
    expect(getSaveCalls()).toBe(1);
  });

  test('preserves restart-safe plan review and MCP auth prompts', async () => {
    const workspace = createWorkspaceSeed();
    const pattern = requireSinglePattern(workspace);
    const planReview = createPendingPlanReview();
    const mcpAuth = createPendingMcpAuth();
    const session = createSession(pattern.id, {
      pendingPlanReview: planReview,
      pendingMcpAuth: mcpAuth,
    });
    workspace.sessions = [session];

    const { service, getSaveCalls } = createService(workspace);

    const loaded = await service.loadWorkspace();
    const cleanedSession = loaded.sessions[0];
    if (!cleanedSession) {
      throw new Error('Expected loadWorkspace to return the session.');
    }

    expect(cleanedSession.status).toBe('idle');
    expect(cleanedSession.pendingPlanReview).toEqual(planReview);
    expect(cleanedSession.pendingMcpAuth).toEqual(mcpAuth);
    expect(getSaveCalls()).toBe(0);
  });
});
