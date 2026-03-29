import { describe, expect, test } from 'bun:test';

import {
  branchSessionRecord,
  duplicateSessionRecord,
  editAndResendSessionRecord,
  querySessions,
  regenerateSessionRecord,
  renameSessionRecord,
  setSessionMessagePinnedRecord,
} from '@shared/domain/sessionLibrary';
import type { PatternDefinition } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import { createWorkspaceSettings } from '@shared/domain/tooling';
import type { WorkspaceState } from '@shared/domain/workspace';

function createPattern(overrides?: Partial<PatternDefinition>): PatternDefinition {
  return {
    id: 'pattern-sequential-review',
    name: 'Sequential Review',
    description: 'Multi-agent review workflow.',
    mode: 'sequential',
    availability: 'available',
    maxIterations: 1,
    agents: [
      {
        id: 'agent-analyst',
        name: 'Analyst',
        description: 'Reviews the request and finds issues.',
        instructions: 'Analyze the request.',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      },
    ],
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
    ...overrides,
  };
}

function createProject(overrides?: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: 'project-alpha',
    name: 'alpha',
    path: 'C:\\workspace\\alpha',
    addedAt: '2026-03-23T00:00:00.000Z',
    ...overrides,
  };
}

function createSession(overrides?: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'session-1',
    projectId: 'project-alpha',
    patternId: 'pattern-sequential-review',
    title: 'Investigate Copilot refresh bug',
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:05:00.000Z',
    status: 'idle',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        authorName: 'You',
        content: 'Please debug why the Copilot CLI version keeps showing unknown.',
        createdAt: '2026-03-23T00:00:00.000Z',
      },
    ],
    runs: [],
    ...overrides,
  };
}

function createWorkspace(overrides?: Partial<WorkspaceState>): WorkspaceState {
  return {
    projects: [createProject(), createProject({ id: 'project-scratchpad', name: 'Scratchpad', path: 'C:\\scratchpad' })],
    patterns: [createPattern(), createPattern({ id: 'pattern-single-chat', name: '1-on-1 Copilot Chat', mode: 'single' })],
    settings: createWorkspaceSettings(),
    sessions: [
      createSession(),
      createSession({
        id: 'session-2',
        projectId: 'project-scratchpad',
        patternId: 'pattern-single-chat',
        title: 'Scratchpad brainstorm',
        status: 'running',
        updatedAt: '2026-03-23T00:10:00.000Z',
        isPinned: true,
        messages: [
          {
            id: 'msg-2',
            role: 'assistant',
            authorName: 'Primary Agent',
            content: 'I am thinking through a scratchpad plan.',
            createdAt: '2026-03-23T00:09:00.000Z',
            pending: true,
          },
        ],
      }),
      createSession({
        id: 'session-3',
        title: 'Archived error session',
        status: 'error',
        isArchived: true,
        updatedAt: '2026-03-23T00:08:00.000Z',
      }),
    ],
    selectedProjectId: 'project-alpha',
    selectedPatternId: 'pattern-sequential-review',
    selectedSessionId: 'session-1',
    lastUpdatedAt: '2026-03-23T00:10:00.000Z',
    ...overrides,
  };
}

describe('session library helpers', () => {
  test('renames sessions with trimmed manual titles', () => {
    const session = renameSessionRecord(createSession(), '  Incident review  ', '2026-03-23T00:06:00.000Z');

    expect(session.title).toBe('Incident review');
    expect(session.titleSource).toBe('manual');
    expect(session.updatedAt).toBe('2026-03-23T00:06:00.000Z');
  });

  test('duplicates sessions as idle unpinned copies', () => {
    const session = duplicateSessionRecord(
      createSession({
        status: 'error',
        isPinned: true,
        isArchived: true,
        lastError: 'sidecar crashed',
        approvalSettings: {
          autoApprovedToolNames: ['git.status'],
        },
        pendingApproval: {
          id: 'approval-1',
          kind: 'tool-call',
          status: 'pending',
          requestedAt: '2026-03-23T00:01:00.000Z',
          title: 'Approve tool access',
        },
        pendingApprovalQueue: [
          {
            id: 'approval-2',
            kind: 'final-response',
            status: 'pending',
            requestedAt: '2026-03-23T00:02:00.000Z',
            title: 'Approve final response',
          },
        ],
        messages: [
          {
            id: 'msg-1',
            role: 'assistant',
            authorName: 'Reviewer',
            content: 'Done.',
            createdAt: '2026-03-23T00:00:00.000Z',
            pending: true,
          },
        ],
      }),
      'session-copy',
      '2026-03-23T00:07:00.000Z',
    );

    expect(session).toMatchObject({
      id: 'session-copy',
      title: 'Investigate Copilot refresh bug (Copy)',
      titleSource: 'manual',
      status: 'idle',
      isPinned: false,
      isArchived: false,
      lastError: undefined,
      createdAt: '2026-03-23T00:07:00.000Z',
      updatedAt: '2026-03-23T00:07:00.000Z',
    });
    expect(session.messages[0]?.pending).toBe(false);
    expect(session.approvalSettings).toEqual({
      autoApprovedToolNames: ['git.status'],
    });
    expect(session.pendingApproval).toBeUndefined();
    expect(session.pendingApprovalQueue).toBeUndefined();
    expect(session.runs).toEqual([]);
  });

  test('pins and unpins messages within a session', () => {
    const pinned = setSessionMessagePinnedRecord(createSession(), 'msg-1', true, '2026-03-23T00:06:00.000Z');

    expect(pinned.updatedAt).toBe('2026-03-23T00:06:00.000Z');
    expect(pinned.messages[0]?.isPinned).toBe(true);

    const unpinned = setSessionMessagePinnedRecord(pinned, 'msg-1', false, '2026-03-23T00:07:00.000Z');
    expect(unpinned.messages[0]?.isPinned).toBeUndefined();
    expect(pinned.messages[0]?.isPinned).toBe(true);
  });

  test('branches sessions from a user message and retains only the prior transcript', () => {
    const sourceSession = createSession({
      title: 'Manual branch source',
      titleSource: 'manual',
      status: 'error',
      isPinned: true,
      isArchived: true,
      lastError: 'sidecar crashed',
      approvalSettings: {
        autoApprovedToolNames: ['git.status'],
      },
      pendingApproval: {
        id: 'approval-1',
        kind: 'tool-call',
        status: 'pending',
        requestedAt: '2026-03-23T00:01:00.000Z',
        title: 'Approve tool access',
      },
      pendingApprovalQueue: [
        {
          id: 'approval-2',
          kind: 'final-response',
          status: 'pending',
          requestedAt: '2026-03-23T00:02:00.000Z',
          title: 'Approve final response',
        },
      ],
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: 'Investigate the refresh bug.',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'I found two likely causes.',
          createdAt: '2026-03-23T00:01:00.000Z',
          pending: true,
        },
        {
          id: 'msg-3',
          role: 'user',
          authorName: 'You',
          content: 'Try a different approach focused on session state.',
          createdAt: '2026-03-23T00:02:00.000Z',
          attachments: [
            {
              type: 'file',
              path: 'C:\\workspace\\alpha\\notes.txt',
              displayName: 'notes.txt',
            },
          ],
        },
        {
          id: 'msg-4',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'Here is the alternate plan.',
          createdAt: '2026-03-23T00:03:00.000Z',
        },
      ],
    });

    const branch = branchSessionRecord(
      sourceSession,
      createPattern(),
      'session-branch',
      'msg-3',
      '2026-03-23T00:04:00.000Z',
    );

    expect(branch).toMatchObject({
      id: 'session-branch',
      title: 'Manual branch source',
      titleSource: 'manual',
      status: 'idle',
      isPinned: false,
      isArchived: false,
      lastError: undefined,
      createdAt: '2026-03-23T00:04:00.000Z',
      updatedAt: '2026-03-23T00:04:00.000Z',
      branchOrigin: {
        sourceSessionId: 'session-1',
        sourceMessageId: 'msg-3',
        sourceMessageIndex: 2,
        branchedAt: '2026-03-23T00:04:00.000Z',
      },
    });
    expect(branch.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(branch.messages[1]?.pending).toBe(false);
    expect(branch.messages[2]?.attachments).toEqual(sourceSession.messages[2]?.attachments);
    expect(branch.messages[2]?.attachments).not.toBe(sourceSession.messages[2]?.attachments);
    expect(branch.messages[1]).not.toBe(sourceSession.messages[1]);
    expect(branch.pendingApproval).toBeUndefined();
    expect(branch.pendingApprovalQueue).toBeUndefined();
    expect(branch.runs).toEqual([]);
    expect(sourceSession.messages[1]?.pending).toBe(true);
  });

  test('rejects branching from non-conversation messages', () => {
    const sourceSession = createSession({
      messages: [
        {
          id: 'msg-1',
          role: 'system' as 'user',
          authorName: 'System',
          content: 'System prompt.',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
      ],
    });

    expect(() =>
      branchSessionRecord(
        sourceSession,
        createPattern(),
        'session-branch',
        'msg-1',
        '2026-03-23T00:04:00.000Z',
      )).toThrow('Only user or assistant messages can be used as a branch point.');
  });

  test('branches from an assistant message and retains transcript up to that response', () => {
    const sourceSession = createSession({
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: 'Investigate the refresh bug.',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'I found two likely causes.',
          createdAt: '2026-03-23T00:01:00.000Z',
        },
        {
          id: 'msg-3',
          role: 'user',
          authorName: 'You',
          content: 'Try a different approach.',
          createdAt: '2026-03-23T00:02:00.000Z',
        },
        {
          id: 'msg-4',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'Here is the alternate plan.',
          createdAt: '2026-03-23T00:03:00.000Z',
        },
      ],
    });

    const branch = branchSessionRecord(
      sourceSession,
      createPattern(),
      'session-branch',
      'msg-2',
      '2026-03-23T00:05:00.000Z',
    );

    expect(branch.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
    expect(branch.branchOrigin).toMatchObject({
      sourceSessionId: 'session-1',
      sourceMessageId: 'msg-2',
      sourceMessageIndex: 1,
      action: 'branch',
    });
  });

  test('regenerates the last assistant message by truncating back to the prior user turn', () => {
    const sourceSession = createSession({
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: 'Investigate the refresh bug.',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'I found two likely causes.',
          createdAt: '2026-03-23T00:01:00.000Z',
        },
        {
          id: 'msg-3',
          role: 'user',
          authorName: 'You',
          content: 'Try a different approach.',
          createdAt: '2026-03-23T00:02:00.000Z',
        },
        {
          id: 'msg-4',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'Here is the alternate plan.',
          createdAt: '2026-03-23T00:03:00.000Z',
          pending: true,
        },
      ],
    });

    const regenerated = regenerateSessionRecord(
      sourceSession,
      createPattern(),
      'session-regenerated',
      'msg-4',
      '2026-03-23T00:06:00.000Z',
    );

    expect(regenerated.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(regenerated.messages[2]?.role).toBe('user');
    expect(regenerated.messages[1]?.pending).toBe(false);
    expect(regenerated.branchOrigin).toMatchObject({
      sourceSessionId: 'session-1',
      sourceMessageId: 'msg-4',
      sourceMessageIndex: 3,
      action: 'regenerate',
    });
  });

  test('rejects regenerating any assistant message except the last one', () => {
    const sourceSession = createSession({
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: 'Investigate the refresh bug.',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'I found two likely causes.',
          createdAt: '2026-03-23T00:01:00.000Z',
        },
        {
          id: 'msg-3',
          role: 'user',
          authorName: 'You',
          content: 'Try a different approach.',
          createdAt: '2026-03-23T00:02:00.000Z',
        },
      ],
    });

    expect(() =>
      regenerateSessionRecord(
        sourceSession,
        createPattern(),
        'session-regenerated',
        'msg-2',
        '2026-03-23T00:06:00.000Z',
      )).toThrow('Only the last assistant message can be regenerated.');
  });

  test('edits and resends a user message by creating an implicit branch', () => {
    const sourceSession = createSession({
      messages: [
        {
          id: 'msg-1',
          role: 'user',
          authorName: 'You',
          content: 'Investigate the refresh bug.',
          createdAt: '2026-03-23T00:00:00.000Z',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'I found two likely causes.',
          createdAt: '2026-03-23T00:01:00.000Z',
        },
        {
          id: 'msg-3',
          role: 'user',
          authorName: 'You',
          content: 'Try a different approach.',
          createdAt: '2026-03-23T00:02:00.000Z',
          attachments: [
            {
              type: 'file',
              path: 'C:\\workspace\\alpha\\notes.txt',
              displayName: 'notes.txt',
            },
          ],
        },
        {
          id: 'msg-4',
          role: 'assistant',
          authorName: 'Reviewer',
          content: 'Here is the alternate plan.',
          createdAt: '2026-03-23T00:03:00.000Z',
        },
      ],
    });

    const edited = editAndResendSessionRecord(
      sourceSession,
      createPattern(),
      'session-edited',
      'msg-3',
      'Focus on session state only.',
      '2026-03-23T00:06:00.000Z',
      [
        {
          type: 'file',
          path: 'C:\\workspace\\alpha\\state-notes.txt',
          displayName: 'state-notes.txt',
        },
      ],
    );

    expect(edited.messages.map((message) => message.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    expect(edited.messages[2]).toMatchObject({
      id: 'msg-3',
      role: 'user',
      content: 'Focus on session state only.',
      attachments: [
        {
          type: 'file',
          path: 'C:\\workspace\\alpha\\state-notes.txt',
          displayName: 'state-notes.txt',
        },
      ],
    });
    expect(edited.messages[2]?.attachments).not.toBe(sourceSession.messages[2]?.attachments);
    expect(edited.branchOrigin).toMatchObject({
      sourceSessionId: 'session-1',
      sourceMessageId: 'msg-3',
      sourceMessageIndex: 2,
      action: 'edit-and-resend',
    });
  });

  test('searches across session title, messages, projects, and patterns', () => {
    const workspace = createWorkspace();

    expect(querySessions(workspace, { searchText: 'copilot alpha review' })).toEqual([
      {
        sessionId: 'session-1',
        score: 31,
        matchedFields: ['title', 'message', 'project', 'pattern'],
      },
    ]);
  });

  test('filters archived sessions by default and can include them explicitly', () => {
    const workspace = createWorkspace();

    expect(querySessions(workspace, { statuses: ['error'] })).toEqual([]);
    expect(querySessions(workspace, { statuses: ['error'], includeArchived: true })).toEqual([
      {
        sessionId: 'session-3',
        score: 0,
        matchedFields: [],
      },
    ]);
  });

  test('supports pinned and scratchpad filters while keeping pinned sessions first', () => {
    const workspace = createWorkspace({
      sessions: [
        createSession({ id: 'session-4', title: 'Pinned idle session', isPinned: true, updatedAt: '2026-03-23T00:04:00.000Z' }),
        ...createWorkspace().sessions,
      ],
    });

    expect(querySessions(workspace, { onlyPinned: true })).toEqual([
      {
        sessionId: 'session-2',
        score: 0,
        matchedFields: [],
      },
      {
        sessionId: 'session-4',
        score: 0,
        matchedFields: [],
      },
    ]);

    expect(querySessions(workspace, { workspaceKinds: ['scratchpad'] })).toEqual([
      {
        sessionId: 'session-2',
        score: 0,
        matchedFields: [],
      },
    ]);
  });
});
