import { describe, expect, test } from 'bun:test';

import {
  approvalPolicyRequiresCheckpoint,
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
});
