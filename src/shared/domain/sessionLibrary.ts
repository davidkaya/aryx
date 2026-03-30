import type { PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';
import type { ChatMessageAttachment } from '@shared/domain/attachment';
import {
  resolveSessionTitle,
  type ChatMessageRecord,
  type SessionBranchOrigin,
  type SessionBranchOriginAction,
  type SessionRecord,
  type SessionStatus,
} from '@shared/domain/session';
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

function cloneAttachments(attachments?: ChatMessageAttachment[]): ChatMessageAttachment[] | undefined {
  const cloned = attachments?.map((attachment) => ({ ...attachment }));
  return cloned && cloned.length > 0 ? cloned : undefined;
}

function cloneChatMessageRecord(message: ChatMessageRecord): ChatMessageRecord {
  return {
    ...message,
    pending: false,
    attachments: cloneAttachments(message.attachments),
  };
}

function requireMessageIndex(session: SessionRecord, messageId: string): number {
  const sourceMessageIndex = session.messages.findIndex((message) => message.id === messageId);
  if (sourceMessageIndex < 0) {
    throw new Error(`Message ${messageId} not found in session ${session.id}.`);
  }

  return sourceMessageIndex;
}

function createBranchOrigin(
  session: SessionRecord,
  messageId: string,
  sourceMessageIndex: number,
  branchedAt: string,
  action: SessionBranchOriginAction,
): SessionBranchOrigin {
  return {
    sourceSessionId: session.id,
    sourceMessageId: messageId,
    sourceMessageIndex,
    branchedAt,
    action,
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
  const sourceMessageIndex = requireMessageIndex(session, messageId);
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
    branchOrigin: createBranchOrigin(session, messageId, sourceMessageIndex, branchedAt, 'branch'),
  };
}

export function setSessionMessagePinnedRecord(
  session: SessionRecord,
  messageId: string,
  isPinned: boolean,
  updatedAt: string,
): SessionRecord {
  const sourceMessageIndex = requireMessageIndex(session, messageId);

  return {
    ...session,
    updatedAt,
    messages: session.messages.map((message, index) => {
      if (index !== sourceMessageIndex) {
        return message;
      }

      if (isPinned) {
        return {
          ...message,
          isPinned: true,
        };
      }

      return {
        ...message,
        isPinned: undefined,
      };
    }),
  };
}

export function regenerateSessionRecord(
  session: SessionRecord,
  pattern: PatternDefinition,
  sessionId: string,
  messageId: string,
  regeneratedAt: string,
): SessionRecord {
  const sourceMessageIndex = requireMessageIndex(session, messageId);
  const sourceMessage = session.messages[sourceMessageIndex];
  if (!sourceMessage) {
    throw new Error(`Message ${messageId} not found in session ${session.id}.`);
  }

  if (sourceMessage.role !== 'assistant') {
    throw new Error('Only assistant messages can be regenerated.');
  }

  if (sourceMessageIndex !== session.messages.length - 1) {
    throw new Error('Only the last assistant message can be regenerated.');
  }

  const priorUserMessageIndex = session.messages
    .slice(0, sourceMessageIndex)
    .map((message, index) => ({ message, index }))
    .filter((candidate) => candidate.message.role === 'user')
    .at(-1)?.index;

  if (priorUserMessageIndex === undefined) {
    throw new Error('Assistant message cannot be regenerated because no prior user message exists.');
  }

  const regeneratedMessages = session.messages
    .slice(0, priorUserMessageIndex + 1)
    .map(cloneChatMessageRecord);

  return {
    ...createDerivedSessionRecord(session, sessionId, regeneratedAt),
    title: resolveSessionTitle(session, pattern, regeneratedMessages),
    messages: regeneratedMessages,
    branchOrigin: createBranchOrigin(session, messageId, sourceMessageIndex, regeneratedAt, 'regenerate'),
  };
}

export function editAndResendSessionRecord(
  session: SessionRecord,
  pattern: PatternDefinition,
  sessionId: string,
  messageId: string,
  content: string,
  editedAt: string,
  attachments?: ChatMessageAttachment[],
): SessionRecord {
  const sourceMessageIndex = requireMessageIndex(session, messageId);
  const sourceMessage = session.messages[sourceMessageIndex];
  if (!sourceMessage) {
    throw new Error(`Message ${messageId} not found in session ${session.id}.`);
  }

  if (sourceMessage.role !== 'user') {
    throw new Error('Only user messages can be edited and resent.');
  }

  const editedMessages = session.messages.slice(0, sourceMessageIndex + 1).map(cloneChatMessageRecord);
  const editedMessage = editedMessages[sourceMessageIndex];
  if (!editedMessage) {
    throw new Error(`Message ${messageId} not found in session ${session.id}.`);
  }

  editedMessage.content = content;
  editedMessage.attachments = cloneAttachments(attachments);

  return {
    ...createDerivedSessionRecord(session, sessionId, editedAt),
    title: resolveSessionTitle(session, pattern, editedMessages),
    messages: editedMessages,
    branchOrigin: createBranchOrigin(session, messageId, sourceMessageIndex, editedAt, 'edit-and-resend'),
  };
}

// ── Pinned messages ──

export interface PinnedMessageHit {
  session: SessionRecord;
  projectName: string;
  message: ChatMessageRecord;
  /** Truncated preview of the message content. */
  snippet: string;
}

function extractMessageSnippet(content: string, maxLength = 120): string {
  const collapsed = content.replace(/\n+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return collapsed.slice(0, maxLength) + '…';
}

export function listPinnedMessages(workspace: WorkspaceState): PinnedMessageHit[] {
  const projectNames = new Map<string, string>(
    workspace.projects.map((p) => [p.id, isScratchpadProject(p) ? 'Scratchpad' : p.name]),
  );

  return workspace.sessions
    .filter((session) => !session.isArchived)
    .flatMap((session) =>
      session.messages
        .filter((message) => message.isPinned && message.content)
        .map((message) => ({
          session,
          projectName: projectNames.get(session.projectId) ?? 'Unknown',
          message,
          snippet: extractMessageSnippet(message.content),
        })),
    )
    .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt));
}

// ── Session query ──

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
