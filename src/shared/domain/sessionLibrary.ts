import type { PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import { resolveSessionTitle, type ChatMessageRecord, type SessionBranchOrigin, type SessionRecord, type SessionStatus } from '@shared/domain/session';
import type { WorkspaceState } from '@shared/domain/workspace';

export type SessionQueryMatchField = 'title' | 'message' | 'project' | 'pattern';
export type SessionWorkspaceKind = 'project' | 'scratchpad';

export interface QuerySessionsInput {
  searchText?: string;
  statuses?: SessionStatus[];
  projectIds?: string[];
  patternIds?: string[];
  workspaceKinds?: SessionWorkspaceKind[];
  includeArchived?: boolean;
  onlyPinned?: boolean;
}

export interface SessionQueryResult {
  sessionId: string;
  score: number;
  matchedFields: SessionQueryMatchField[];
}

const fieldWeights: Record<SessionQueryMatchField, number> = {
  title: 12,
  project: 8,
  pattern: 7,
  message: 4,
};

const orderedMatchFields: SessionQueryMatchField[] = ['title', 'message', 'project', 'pattern'];

interface SessionSearchFields {
  title: string;
  message: string;
  project: string;
  pattern: string;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function tokenizeSearchText(value?: string): string[] {
  if (!value) {
    return [];
  }

  return normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function buildSearchFields(
  session: SessionRecord,
  project?: ProjectRecord,
  pattern?: PatternDefinition,
): SessionSearchFields {
  return {
    title: normalizeSearchText(session.title),
    message: normalizeSearchText(session.messages.map((message) => message.content).join('\n')),
    project: normalizeSearchText([project?.name, project?.path].filter(Boolean).join('\n')),
    pattern: normalizeSearchText(
      [
        pattern?.name,
        pattern?.description,
        pattern?.mode,
        ...(pattern?.agents.flatMap((agent) => [agent.name, agent.description]) ?? []),
      ]
        .filter(Boolean)
        .join('\n'),
    ),
  };
}

function resolveSearchMatch(
  fields: SessionSearchFields,
  tokens: string[],
): Pick<SessionQueryResult, 'score' | 'matchedFields'> | undefined {
  if (tokens.length === 0) {
    return {
      score: 0,
      matchedFields: [],
    };
  }

  const matched = new Set<SessionQueryMatchField>();
  let score = 0;

  for (const token of tokens) {
    let tokenMatched = false;

    for (const field of orderedMatchFields) {
      if (!fields[field].includes(token)) {
        continue;
      }

      tokenMatched = true;
      matched.add(field);
      score += fieldWeights[field];
    }

    if (!tokenMatched) {
      return undefined;
    }
  }

  return {
    score,
    matchedFields: orderedMatchFields.filter((field) => matched.has(field)),
  };
}

function matchesFilters(
  session: SessionRecord,
  input: QuerySessionsInput,
  workspaceKind: SessionWorkspaceKind,
): boolean {
  if (!input.includeArchived && session.isArchived) {
    return false;
  }

  if (input.onlyPinned && !session.isPinned) {
    return false;
  }

  if (input.statuses && input.statuses.length > 0 && !input.statuses.includes(session.status)) {
    return false;
  }

  if (input.projectIds && input.projectIds.length > 0 && !input.projectIds.includes(session.projectId)) {
    return false;
  }

  if (input.patternIds && input.patternIds.length > 0 && !input.patternIds.includes(session.patternId)) {
    return false;
  }

  if (input.workspaceKinds && input.workspaceKinds.length > 0 && !input.workspaceKinds.includes(workspaceKind)) {
    return false;
  }

  return true;
}

export function renameSessionRecord(session: SessionRecord, title: string, updatedAt: string): SessionRecord {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error('Session title is required.');
  }

  return {
    ...session,
    title: trimmedTitle,
    titleSource: 'manual',
    updatedAt,
  };
}

function cloneBranchOrigin(branchOrigin?: SessionBranchOrigin): SessionBranchOrigin | undefined {
  return branchOrigin ? { ...branchOrigin } : undefined;
}

function cloneChatMessageRecord(message: ChatMessageRecord): ChatMessageRecord {
  return {
    ...message,
    pending: false,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
  };
}

function createDerivedSessionRecord(
  session: SessionRecord,
  sessionId: string,
  createdAt: string,
): SessionRecord {
  return {
    ...session,
    id: sessionId,
    createdAt,
    updatedAt: createdAt,
    status: 'idle',
    isPinned: false,
    isArchived: false,
    branchOrigin: cloneBranchOrigin(session.branchOrigin),
    lastError: undefined,
    sessionModelConfig: session.sessionModelConfig ? { ...session.sessionModelConfig } : undefined,
    tooling: session.tooling
      ? {
          enabledMcpServerIds: [...session.tooling.enabledMcpServerIds],
          enabledLspProfileIds: [...session.tooling.enabledLspProfileIds],
        }
      : undefined,
    approvalSettings: session.approvalSettings
      ? {
          autoApprovedToolNames: [...session.approvalSettings.autoApprovedToolNames],
        }
      : undefined,
    pendingApproval: undefined,
    pendingApprovalQueue: undefined,
    pendingUserInput: undefined,
    pendingPlanReview: undefined,
    pendingMcpAuth: undefined,
    runs: [],
    messages: [],
  };
}

export function duplicateSessionRecord(
  session: SessionRecord,
  sessionId: string,
  duplicatedAt: string,
): SessionRecord {
  return {
    ...createDerivedSessionRecord(session, sessionId, duplicatedAt),
    title: `${session.title} (Copy)`,
    titleSource: 'manual',
    messages: session.messages.map(cloneChatMessageRecord),
  };
}

export function branchSessionRecord(
  session: SessionRecord,
  pattern: PatternDefinition,
  sessionId: string,
  messageId: string,
  branchedAt: string,
): SessionRecord {
  const sourceMessageIndex = session.messages.findIndex((message) => message.id === messageId);
  if (sourceMessageIndex < 0) {
    throw new Error(`Message ${messageId} not found in session ${session.id}.`);
  }

  const sourceMessage = session.messages[sourceMessageIndex];
  if (!sourceMessage) {
    throw new Error(`Message ${messageId} not found in session ${session.id}.`);
  }

  if (sourceMessage.role !== 'user' && sourceMessage.role !== 'assistant') {
    throw new Error('Only user or assistant messages can be used as a branch point.');
  }

  const branchedMessages = session.messages.slice(0, sourceMessageIndex + 1).map(cloneChatMessageRecord);

  return {
    ...createDerivedSessionRecord(session, sessionId, branchedAt),
    title: resolveSessionTitle(session, pattern, branchedMessages),
    messages: branchedMessages,
    branchOrigin: {
      sourceSessionId: session.id,
      sourceMessageId: messageId,
      sourceMessageIndex,
      branchedAt,
    },
  };
}

export function querySessions(workspace: WorkspaceState, input: QuerySessionsInput): SessionQueryResult[] {
  const projectsById = new Map<string, ProjectRecord>(workspace.projects.map((project) => [project.id, project]));
  const patternsById = new Map<string, PatternDefinition>(workspace.patterns.map((pattern) => [pattern.id, pattern]));
  const searchTokens = tokenizeSearchText(input.searchText);

  return workspace.sessions
    .flatMap((session) => {
      const workspaceKind: SessionWorkspaceKind = isScratchpadProject(session.projectId) ? 'scratchpad' : 'project';
      if (!matchesFilters(session, input, workspaceKind)) {
        return [];
      }

      const searchMatch = resolveSearchMatch(
        buildSearchFields(session, projectsById.get(session.projectId), patternsById.get(session.patternId)),
        searchTokens,
      );
      if (!searchMatch) {
        return [];
      }

      return [
        {
          sessionId: session.id,
          score: searchMatch.score,
          matchedFields: searchMatch.matchedFields,
        },
      ];
    })
    .sort((left, right) => {
      const leftSession = workspace.sessions.find((session) => session.id === left.sessionId);
      const rightSession = workspace.sessions.find((session) => session.id === right.sessionId);
      if (!leftSession || !rightSession) {
        return 0;
      }

      if (leftSession.isPinned !== rightSession.isPinned) {
        return leftSession.isPinned ? -1 : 1;
      }

      if (leftSession.isArchived !== rightSession.isArchived) {
        return leftSession.isArchived ? 1 : -1;
      }

      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return rightSession.updatedAt.localeCompare(leftSession.updatedAt);
    });
}
