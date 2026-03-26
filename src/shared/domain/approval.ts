import type { PermissionDetail } from '@shared/contracts/sidecar';

export type ApprovalCheckpointKind = 'tool-call' | 'final-response';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalDecision = Exclude<ApprovalStatus, 'pending'>;

export interface ApprovalCheckpointRule {
  kind: ApprovalCheckpointKind;
  agentIds?: string[];
}

export interface ApprovalPolicy {
  rules: ApprovalCheckpointRule[];
  autoApprovedToolNames?: string[];
}

export interface SessionApprovalSettings {
  autoApprovedToolNames: string[];
}

export interface PendingApprovalMessageRecord {
  id: string;
  authorName: string;
  content: string;
}

export interface PendingApprovalRecord {
  id: string;
  kind: ApprovalCheckpointKind;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  permissionKind?: string;
  title: string;
  detail?: string;
  messages?: PendingApprovalMessageRecord[];
  permissionDetail?: PermissionDetail;
}

export interface PendingApprovalState {
  pendingApproval?: PendingApprovalRecord;
  pendingApprovalQueue?: PendingApprovalRecord[];
}

const approvalCheckpointKinds: ApprovalCheckpointKind[] = ['tool-call', 'final-response'];
const approvalCheckpointKindSet = new Set<ApprovalCheckpointKind>(approvalCheckpointKinds);
const approvalStatusSet = new Set<ApprovalStatus>(['pending', 'approved', 'rejected']);

export function createDefaultToolApprovalPolicy(): ApprovalPolicy {
  return {
    rules: [{ kind: 'tool-call' }],
  };
}

export function applyDefaultToolApprovalPolicy(
  policy?: Partial<ApprovalPolicy>,
): ApprovalPolicy {
  return normalizeApprovalPolicy(policy) ?? createDefaultToolApprovalPolicy();
}

export function isApprovalCheckpointKind(value: string | undefined): value is ApprovalCheckpointKind {
  return value !== undefined && approvalCheckpointKindSet.has(value as ApprovalCheckpointKind);
}

export function isApprovalStatus(value: string | undefined): value is ApprovalStatus {
  return value !== undefined && approvalStatusSet.has(value as ApprovalStatus);
}

export function normalizeApprovalPolicy(policy?: Partial<ApprovalPolicy>): ApprovalPolicy | undefined {
  if (policy == null) {
    return undefined;
  }

  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  const selectedAgents = new Map<ApprovalCheckpointKind, Set<string>>();
  const appliesToAllAgents = new Set<ApprovalCheckpointKind>();
  const autoApprovedToolNames = normalizeStringArray(policy?.autoApprovedToolNames);

  for (const rule of rules) {
    if (!isApprovalCheckpointKind(rule?.kind)) {
      continue;
    }

    const normalizedAgentIds = normalizeStringArray(rule.agentIds);
    if (normalizedAgentIds.length === 0) {
      appliesToAllAgents.add(rule.kind);
      selectedAgents.delete(rule.kind);
      continue;
    }

    if (appliesToAllAgents.has(rule.kind)) {
      continue;
    }

    const existing = selectedAgents.get(rule.kind) ?? new Set<string>();
    for (const agentId of normalizedAgentIds) {
      existing.add(agentId);
    }
    selectedAgents.set(rule.kind, existing);
  }

  const normalizedRules = approvalCheckpointKinds.flatMap((kind): ApprovalCheckpointRule[] => {
    if (appliesToAllAgents.has(kind)) {
      return [{ kind }];
    }

    const agentIds = [...(selectedAgents.get(kind) ?? [])];
    if (agentIds.length === 0) {
      return [];
    }

    return [{ kind, agentIds }];
  });

  if (normalizedRules.length === 0 && autoApprovedToolNames.length === 0) {
    return {
      rules: [],
    };
  }

  return {
    rules: normalizedRules,
    autoApprovedToolNames: autoApprovedToolNames.length > 0 ? autoApprovedToolNames : undefined,
  };
}

export function normalizeSessionApprovalSettings(
  settings?: Partial<SessionApprovalSettings>,
): SessionApprovalSettings | undefined {
  if (settings == null) {
    return undefined;
  }

  return {
    autoApprovedToolNames: normalizeStringArray(settings.autoApprovedToolNames),
  };
}

export function validateApprovalPolicy(
  policy: ApprovalPolicy | undefined,
  knownAgentIds: readonly string[],
  knownToolNames?: readonly string[],
): string[] {
  if (!policy) {
    return [];
  }

  const knownAgents = new Set(normalizeStringArray(knownAgentIds));
  const knownTools = knownToolNames ? new Set(normalizeStringArray(knownToolNames)) : undefined;
  const issues: string[] = [];

  for (const rule of policy.rules) {
    for (const agentId of rule.agentIds ?? []) {
      if (!knownAgents.has(agentId)) {
        issues.push(`Approval checkpoint "${rule.kind}" references unknown agent "${agentId}".`);
      }
    }
  }

  if (knownTools) {
    for (const toolName of policy.autoApprovedToolNames ?? []) {
      if (!knownTools.has(toolName)) {
        issues.push(`Approval auto-approve references unknown tool "${toolName}".`);
      }
    }
  }

  return issues;
}

export function approvalPolicyRequiresCheckpoint(
  policy: ApprovalPolicy | undefined,
  kind: ApprovalCheckpointKind,
  agentId?: string,
): boolean {
  const rule = policy?.rules.find((candidate) => candidate.kind === kind);
  if (!rule) {
    return false;
  }

  if (!rule.agentIds || rule.agentIds.length === 0) {
    return true;
  }

  const normalizedAgentId = normalizeOptionalString(agentId);
  if (!normalizedAgentId) {
    return false;
  }

  return rule.agentIds.includes(normalizedAgentId);
}

export function approvalPolicyAutoApprovesTool(
  policy: ApprovalPolicy | undefined,
  toolName?: string,
): boolean {
  const normalizedToolName = normalizeOptionalString(toolName);
  if (!normalizedToolName) {
    return false;
  }

  return policy?.autoApprovedToolNames?.includes(normalizedToolName) ?? false;
}

export function approvalPolicyRequiresToolCallApproval(
  policy: ApprovalPolicy | undefined,
  agentId?: string,
  toolName?: string,
): boolean {
  if (!approvalPolicyRequiresCheckpoint(policy, 'tool-call', agentId)) {
    return false;
  }

  return !approvalPolicyAutoApprovesTool(policy, toolName);
}

export function resolveEffectiveApprovalPolicy(
  policy: ApprovalPolicy | undefined,
  sessionSettings?: Partial<SessionApprovalSettings>,
): ApprovalPolicy | undefined {
  if (sessionSettings === undefined) {
    return normalizeApprovalPolicy(policy);
  }

  const normalizedPolicy = normalizeApprovalPolicy(policy);
  const normalizedSessionSettings = normalizeSessionApprovalSettings(sessionSettings);
  return normalizeApprovalPolicy({
    rules: normalizedPolicy?.rules ?? [],
    autoApprovedToolNames: normalizedSessionSettings?.autoApprovedToolNames,
  });
}

export function pruneApprovalPolicyTools(
  policy: ApprovalPolicy | undefined,
  knownToolNames: readonly string[],
): ApprovalPolicy | undefined {
  const normalizedPolicy = normalizeApprovalPolicy(policy);
  if (!normalizedPolicy) {
    return undefined;
  }

  return normalizeApprovalPolicy({
    ...normalizedPolicy,
    autoApprovedToolNames: filterKnownToolNames(
      normalizedPolicy.autoApprovedToolNames,
      knownToolNames,
    ),
  });
}

export function pruneSessionApprovalSettings(
  settings: SessionApprovalSettings | undefined,
  knownToolNames: readonly string[],
): SessionApprovalSettings | undefined {
  const normalizedSettings = normalizeSessionApprovalSettings(settings);
  if (normalizedSettings === undefined) {
    return undefined;
  }

  return {
    autoApprovedToolNames: filterKnownToolNames(
      normalizedSettings.autoApprovedToolNames,
      knownToolNames,
    ),
  };
}

export function normalizePendingApproval(
  approval?: Partial<PendingApprovalRecord>,
): PendingApprovalRecord | undefined {
  const id = normalizeOptionalString(approval?.id);
  const kind = isApprovalCheckpointKind(approval?.kind) ? approval.kind : undefined;
  const status = isApprovalStatus(approval?.status) ? approval.status : undefined;
  const requestedAt = normalizeOptionalString(approval?.requestedAt);
  const title = normalizeOptionalString(approval?.title);
  if (!id || !kind || !status || !requestedAt || !title) {
    return undefined;
  }

  return {
    id,
    kind,
    status,
    requestedAt,
    resolvedAt: status === 'pending' ? undefined : normalizeOptionalString(approval?.resolvedAt),
    agentId: normalizeOptionalString(approval?.agentId),
    agentName: normalizeOptionalString(approval?.agentName),
    toolName: normalizeOptionalString(approval?.toolName),
    permissionKind: normalizeOptionalString(approval?.permissionKind),
    title,
    detail: normalizeOptionalString(approval?.detail),
    messages: normalizePendingApprovalMessages(approval?.messages),
    permissionDetail: approval?.permissionDetail,
  };
}

export function resolvePendingApproval(
  approval: PendingApprovalRecord,
  decision: ApprovalDecision,
  resolvedAt: string,
  detail?: string,
): PendingApprovalRecord {
  return {
    ...approval,
    status: decision,
    resolvedAt,
    detail: normalizeOptionalString(detail) ?? approval.detail,
  };
}

export function listPendingApprovals(
  state: Partial<PendingApprovalState>,
): PendingApprovalRecord[] {
  const pendingApprovals: PendingApprovalRecord[] = [];
  const seenApprovalIds = new Set<string>();

  function appendApproval(approval?: Partial<PendingApprovalRecord>) {
    const normalized = normalizePendingApproval(approval);
    if (!normalized || normalized.status !== 'pending' || seenApprovalIds.has(normalized.id)) {
      return;
    }

    seenApprovalIds.add(normalized.id);
    pendingApprovals.push(normalized);
  }

  appendApproval(state.pendingApproval);
  for (const queuedApproval of state.pendingApprovalQueue ?? []) {
    appendApproval(queuedApproval);
  }

  return pendingApprovals;
}

export function normalizePendingApprovalState(
  state: Partial<PendingApprovalState>,
): PendingApprovalState {
  return splitPendingApprovalState(listPendingApprovals(state));
}

export function enqueuePendingApprovalState(
  state: Partial<PendingApprovalState>,
  approval: PendingApprovalRecord,
): PendingApprovalState {
  return normalizePendingApprovalState({
    pendingApproval: state.pendingApproval,
    pendingApprovalQueue: [
      ...(state.pendingApprovalQueue ?? []),
      approval,
    ],
  });
}

export function dequeuePendingApprovalState(
  state: Partial<PendingApprovalState>,
  approvalId: string,
): PendingApprovalState {
  return splitPendingApprovalState(
    listPendingApprovals(state).filter((approval) => approval.id !== approvalId),
  );
}

function normalizePendingApprovalMessages(
  messages?: ReadonlyArray<Partial<PendingApprovalMessageRecord>>,
): PendingApprovalMessageRecord[] | undefined {
  if (!messages || messages.length === 0) {
    return undefined;
  }

  const normalized = messages.flatMap((message) => {
    const id = normalizeOptionalString(message.id);
    const authorName = normalizeOptionalString(message.authorName);
    if (!id || !authorName) {
      return [];
    }

    return [{
      id,
      authorName,
      content: message.content ?? '',
    }];
  });

  return normalized.length > 0 ? normalized : undefined;
}

function splitPendingApprovalState(
  approvals: readonly PendingApprovalRecord[],
): PendingApprovalState {
  if (approvals.length === 0) {
    return {
      pendingApproval: undefined,
      pendingApprovalQueue: undefined,
    };
  }

  return {
    pendingApproval: approvals[0],
    pendingApprovalQueue: approvals.length > 1 ? approvals.slice(1) : undefined,
  };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeStringArray(values?: ReadonlyArray<string>): string[] {
  if (!values) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function filterKnownToolNames(
  toolNames: readonly string[] | undefined,
  knownToolNames: readonly string[],
): string[] {
  const knownTools = new Set(normalizeStringArray(knownToolNames));
  return normalizeStringArray(toolNames).filter((toolName) => knownTools.has(toolName));
}
