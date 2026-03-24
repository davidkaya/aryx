export type ApprovalCheckpointKind = 'tool-call' | 'final-response';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type ApprovalDecision = Exclude<ApprovalStatus, 'pending'>;

export interface ApprovalCheckpointRule {
  kind: ApprovalCheckpointKind;
  agentIds?: string[];
}

export interface ApprovalPolicy {
  rules: ApprovalCheckpointRule[];
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
}

const approvalCheckpointKinds: ApprovalCheckpointKind[] = ['tool-call', 'final-response'];
const approvalCheckpointKindSet = new Set<ApprovalCheckpointKind>(approvalCheckpointKinds);
const approvalStatusSet = new Set<ApprovalStatus>(['pending', 'approved', 'rejected']);

export function isApprovalCheckpointKind(value: string | undefined): value is ApprovalCheckpointKind {
  return value !== undefined && approvalCheckpointKindSet.has(value as ApprovalCheckpointKind);
}

export function isApprovalStatus(value: string | undefined): value is ApprovalStatus {
  return value !== undefined && approvalStatusSet.has(value as ApprovalStatus);
}

export function normalizeApprovalPolicy(policy?: Partial<ApprovalPolicy>): ApprovalPolicy | undefined {
  const rules = Array.isArray(policy?.rules) ? policy.rules : [];
  const selectedAgents = new Map<ApprovalCheckpointKind, Set<string>>();
  const appliesToAllAgents = new Set<ApprovalCheckpointKind>();

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

  return normalizedRules.length > 0 ? { rules: normalizedRules } : undefined;
}

export function validateApprovalPolicy(
  policy: ApprovalPolicy | undefined,
  knownAgentIds: readonly string[],
): string[] {
  if (!policy) {
    return [];
  }

  const knownAgents = new Set(normalizeStringArray(knownAgentIds));
  const issues: string[] = [];

  for (const rule of policy.rules) {
    for (const agentId of rule.agentIds ?? []) {
      if (!knownAgents.has(agentId)) {
        issues.push(`Approval checkpoint "${rule.kind}" references unknown agent "${agentId}".`);
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
