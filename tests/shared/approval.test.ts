import { describe, expect, test } from 'bun:test';

import {
  applyDefaultToolApprovalPolicy,
  approvalPolicyRequiresToolCallApproval,
  approvalPolicyRequiresCheckpoint,
  normalizeApprovalPolicy,
  normalizePendingApproval,
  normalizePendingApprovalState,
  normalizeSessionApprovalSettings,
  pruneSessionApprovalSettings,
  resolveApprovalToolKey,
  dequeuePendingApprovalState,
  enqueuePendingApprovalState,
  listPendingApprovals,
  resolveEffectiveApprovalPolicy,
} from '@shared/domain/approval';

describe('approval helpers', () => {
  test('applies tool-call approval by default while preserving an explicit empty policy', () => {
    expect(applyDefaultToolApprovalPolicy()).toEqual({
      rules: [{ kind: 'tool-call' }],
    });

    expect(normalizeApprovalPolicy({})).toEqual({
      rules: [],
    });

    expect(applyDefaultToolApprovalPolicy({})).toEqual({
      rules: [],
    });
  });

  test('normalizes duplicate checkpoint rules and auto-approved tools into stable policy entries', () => {
    expect(normalizeApprovalPolicy({
      rules: [
        { kind: 'tool-call', agentIds: ['agent-1', ' agent-1 ', 'agent-2'] },
        { kind: 'tool-call', agentIds: ['agent-2', 'agent-3'] },
        { kind: 'final-response', agentIds: [] },
      ],
      autoApprovedToolNames: [' git.status ', 'git.status', 'lsp_ts_hover'],
    })).toEqual({
      rules: [
        { kind: 'tool-call', agentIds: ['agent-1', 'agent-2', 'agent-3'] },
        { kind: 'final-response' },
      ],
      autoApprovedToolNames: ['git.status', 'lsp_ts_hover'],
    });
  });

  test('matches approval requirements for all-agent and agent-specific rules', () => {
    const policy = normalizeApprovalPolicy({
      rules: [
        { kind: 'tool-call', agentIds: ['agent-1'] },
        { kind: 'final-response', agentIds: [] },
      ],
      autoApprovedToolNames: ['git.status'],
    });

    expect(approvalPolicyRequiresCheckpoint(policy, 'tool-call', 'agent-1')).toBe(true);
    expect(approvalPolicyRequiresCheckpoint(policy, 'tool-call', 'agent-2')).toBe(false);
    expect(approvalPolicyRequiresCheckpoint(policy, 'final-response', 'agent-2')).toBe(true);
    expect(approvalPolicyRequiresToolCallApproval(policy, 'agent-1', 'git.status')).toBe(false);
    expect(approvalPolicyRequiresToolCallApproval(policy, 'agent-1', 'git.diff')).toBe(true);
    expect(approvalPolicyRequiresToolCallApproval(policy, 'agent-2', 'git.diff')).toBe(false);
  });

  test('resolves session approval settings over pattern auto-approval defaults', () => {
    expect(resolveEffectiveApprovalPolicy(
      {
        rules: [{ kind: 'tool-call' }],
        autoApprovedToolNames: ['git.status'],
      },
      normalizeSessionApprovalSettings({
        autoApprovedToolNames: ['git.diff'],
      }),
    )).toEqual({
      rules: [{ kind: 'tool-call' }],
      autoApprovedToolNames: ['git.diff'],
    });

    expect(resolveEffectiveApprovalPolicy(
      {
        rules: [{ kind: 'tool-call' }],
        autoApprovedToolNames: ['git.status'],
      },
      normalizeSessionApprovalSettings({
        autoApprovedToolNames: [],
      }),
    )).toEqual({
      rules: [{ kind: 'tool-call' }],
    });
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

  test('prune preserves permission-kind approval entries when they are known tools', () => {
    const settings = normalizeSessionApprovalSettings({
      autoApprovedToolNames: ['read', 'write', 'shell', 'git.status', 'unknown_tool'],
    });
    const knownToolNames = ['read', 'write', 'shell', 'git.status', 'bash', 'view'];

    const pruned = pruneSessionApprovalSettings(settings, knownToolNames);
    expect(pruned?.autoApprovedToolNames).toEqual(['read', 'write', 'shell', 'git.status']);
  });

  test('session approval with permission-kind entries overrides pattern defaults', () => {
    const effective = resolveEffectiveApprovalPolicy(
      {
        rules: [{ kind: 'tool-call' }],
        autoApprovedToolNames: ['git.status'],
      },
      normalizeSessionApprovalSettings({
        autoApprovedToolNames: ['read', 'shell'],
      }),
    );

    expect(effective).toEqual({
      rules: [{ kind: 'tool-call' }],
      autoApprovedToolNames: ['read', 'shell'],
    });
    expect(approvalPolicyRequiresToolCallApproval(effective, 'agent-1', 'read')).toBe(false);
    expect(approvalPolicyRequiresToolCallApproval(effective, 'agent-1', 'shell')).toBe(false);
    expect(approvalPolicyRequiresToolCallApproval(effective, 'agent-1', 'write')).toBe(true);
  });

  test('resolveApprovalToolKey returns permission category for runtime tools', () => {
    expect(resolveApprovalToolKey('view', 'read')).toBe('read');
    expect(resolveApprovalToolKey('edit', 'write')).toBe('write');
    expect(resolveApprovalToolKey('bash', 'shell')).toBe('shell');
    expect(resolveApprovalToolKey('web_fetch', 'url')).toBe('web_fetch');
    expect(resolveApprovalToolKey('store_memory', 'memory')).toBe('store_memory');
  });

  test('resolveApprovalToolKey returns tool name for non-runtime tools', () => {
    expect(resolveApprovalToolKey('git.status', 'mcp')).toBe('git.status');
    expect(resolveApprovalToolKey('lsp_ts_hover', 'custom-tool')).toBe('lsp_ts_hover');
    expect(resolveApprovalToolKey('web_fetch', 'hook')).toBe('web_fetch');
    expect(resolveApprovalToolKey('some_tool', undefined)).toBe('some_tool');
  });

  test('resolveApprovalToolKey returns undefined when both are absent', () => {
    expect(resolveApprovalToolKey(undefined, undefined)).toBeUndefined();
    expect(resolveApprovalToolKey(undefined, 'mcp')).toBeUndefined();
  });
});
