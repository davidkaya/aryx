import { describe, expect, test } from 'bun:test';

import {
  dequeuePendingApprovalState,
  enqueuePendingApprovalState,
  listPendingApprovals,
  approvalPolicyRequiresCheckpoint,
  normalizePendingApprovalState,
  normalizeApprovalPolicy,
  normalizePendingApproval,
} from '@shared/domain/approval';

describe('approval helpers', () => {
  test('normalizes duplicate checkpoint rules into stable agent-scoped policy entries', () => {
    expect(normalizeApprovalPolicy({
      rules: [
        { kind: 'tool-call', agentIds: ['agent-1', ' agent-1 ', 'agent-2'] },
        { kind: 'tool-call', agentIds: ['agent-2', 'agent-3'] },
        { kind: 'final-response', agentIds: [] },
      ],
    })).toEqual({
      rules: [
        { kind: 'tool-call', agentIds: ['agent-1', 'agent-2', 'agent-3'] },
        { kind: 'final-response' },
      ],
    });
  });

  test('matches approval requirements for all-agent and agent-specific rules', () => {
    const policy = normalizeApprovalPolicy({
      rules: [
        { kind: 'tool-call', agentIds: ['agent-1'] },
        { kind: 'final-response', agentIds: [] },
      ],
    });

    expect(approvalPolicyRequiresCheckpoint(policy, 'tool-call', 'agent-1')).toBe(true);
    expect(approvalPolicyRequiresCheckpoint(policy, 'tool-call', 'agent-2')).toBe(false);
    expect(approvalPolicyRequiresCheckpoint(policy, 'final-response', 'agent-2')).toBe(true);
  });

  test('normalizes pending approvals with optional message previews', () => {
    expect(normalizePendingApproval({
      id: 'approval-1',
      kind: 'final-response',
      status: 'pending',
      requestedAt: '2026-03-24T10:00:00.000Z',
      title: 'Approve final response',
      messages: [
        {
          id: 'msg-1',
          authorName: 'Primary Agent',
          content: 'Draft answer',
        },
      ],
    })).toEqual({
      id: 'approval-1',
      kind: 'final-response',
      status: 'pending',
      requestedAt: '2026-03-24T10:00:00.000Z',
      title: 'Approve final response',
      messages: [
        {
          id: 'msg-1',
          authorName: 'Primary Agent',
          content: 'Draft answer',
        },
      ],
    });
  });

  test('normalizes legacy active approval plus queued approvals into a stable pending state', () => {
    expect(normalizePendingApprovalState({
      pendingApproval: {
        id: 'approval-1',
        kind: 'tool-call',
        status: 'pending',
        requestedAt: '2026-03-24T10:00:00.000Z',
        title: 'Approve tool access',
      },
      pendingApprovalQueue: [
        {
          id: 'approval-1',
          kind: 'tool-call',
          status: 'pending',
          requestedAt: '2026-03-24T10:00:00.000Z',
          title: 'Approve tool access',
        },
        {
          id: 'approval-2',
          kind: 'final-response',
          status: 'pending',
          requestedAt: '2026-03-24T10:01:00.000Z',
          title: 'Approve final response',
        },
        {
          id: 'approval-3',
          kind: 'tool-call',
          status: 'approved',
          requestedAt: '2026-03-24T10:02:00.000Z',
          resolvedAt: '2026-03-24T10:03:00.000Z',
          title: 'Already resolved',
        },
      ],
    })).toEqual({
      pendingApproval: {
        id: 'approval-1',
        kind: 'tool-call',
        status: 'pending',
        requestedAt: '2026-03-24T10:00:00.000Z',
        title: 'Approve tool access',
      },
      pendingApprovalQueue: [
        {
          id: 'approval-2',
          kind: 'final-response',
          status: 'pending',
          requestedAt: '2026-03-24T10:01:00.000Z',
          title: 'Approve final response',
        },
      ],
    });
  });

  test('enqueues and dequeues pending approvals while keeping the first approval active', () => {
    const state = enqueuePendingApprovalState(
      {
        pendingApproval: {
          id: 'approval-1',
          kind: 'tool-call',
          status: 'pending',
          requestedAt: '2026-03-24T10:00:00.000Z',
          title: 'Approve tool access',
        },
      },
      {
        id: 'approval-2',
        kind: 'final-response',
        status: 'pending',
        requestedAt: '2026-03-24T10:01:00.000Z',
        title: 'Approve final response',
      },
    );

    expect(listPendingApprovals(state).map((approval) => approval.id)).toEqual([
      'approval-1',
      'approval-2',
    ]);

    expect(dequeuePendingApprovalState(state, 'approval-1')).toEqual({
      pendingApproval: {
        id: 'approval-2',
        kind: 'final-response',
        status: 'pending',
        requestedAt: '2026-03-24T10:01:00.000Z',
        title: 'Approve final response',
      },
      pendingApprovalQueue: undefined,
    });
  });
});
