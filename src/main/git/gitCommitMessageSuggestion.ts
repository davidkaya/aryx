import { basename } from 'node:path';

import type {
  ProjectGitCommitMessageSuggestion,
  ProjectGitConventionalCommitType,
  ProjectGitRunChangeSummary,
} from '@shared/domain/project';
import type { SessionRecord } from '@shared/domain/session';
import type { SessionRunRecord } from '@shared/domain/runTimeline';

interface BuildCommitMessageSuggestionInput {
  session: Pick<SessionRecord, 'messages' | 'title'>;
  run: Pick<SessionRunRecord, 'triggerMessageId'>;
  summary?: ProjectGitRunChangeSummary;
  conventionalType?: ProjectGitConventionalCommitType;
}

const COMMIT_TYPES: readonly ProjectGitConventionalCommitType[] = [
  'feat',
  'fix',
  'refactor',
  'docs',
  'test',
  'chore',
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isCommitType(value: string | undefined): value is ProjectGitConventionalCommitType {
  return value !== undefined && COMMIT_TYPES.includes(value as ProjectGitConventionalCommitType);
}

function findTriggerMessageContent(
  session: Pick<SessionRecord, 'messages'>,
  triggerMessageId: string,
): string | undefined {
  return session.messages.find((message) => message.id === triggerMessageId)?.content;
}

function inferCommitTypeFromSummary(
  prompt: string | undefined,
  summary: ProjectGitRunChangeSummary | undefined,
): ProjectGitConventionalCommitType {
  const promptText = normalizeWhitespace(prompt?.toLowerCase() ?? '');
  const files = summary?.files ?? [];
  const filePaths = files.map((file) => file.path.toLowerCase());
  if (filePaths.length > 0 && filePaths.every((path) => path.endsWith('.md') || path.includes('readme'))) {
    return 'docs';
  }

  if (filePaths.length > 0 && filePaths.every((path) => path.includes('test') || path.endsWith('.snap'))) {
    return 'test';
  }

  if (/\b(fix|bug|error|issue|regression|broken|failure)\b/.test(promptText)) {
    return 'fix';
  }

  if (/\b(refactor|cleanup|restructure|rename|simplify)\b/.test(promptText)) {
    return 'refactor';
  }

  if (/\b(doc|readme|documentation)\b/.test(promptText)) {
    return 'docs';
  }

  if (/\b(test|coverage|assertion)\b/.test(promptText)) {
    return 'test';
  }

  if (/\b(chore|config|build|deps|dependency|tooling)\b/.test(promptText)) {
    return 'chore';
  }

  return 'feat';
}

function stripPromptLead(text: string): string {
  return text
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .replace(/^(please\s+)?(can|could|would)\s+you\s+/i, '')
    .replace(/^(implement|add|create|build|make|update|improve|refactor|fix|support|handle)\s+/i, '')
    .replace(/[.?!:;]+$/g, '')
    .trim();
}

function summarizeFiles(summary: ProjectGitRunChangeSummary | undefined): string | undefined {
  const firstFile = summary?.files[0];
  if (!summary || summary.files.length === 0 || !firstFile) {
    return undefined;
  }

  if (summary.files.length === 1) {
    return basename(firstFile.path).replace(/\.[^.]+$/, '');
  }

  return `${summary.fileCount} files`;
}

function buildSubject(
  prompt: string | undefined,
  summary: ProjectGitRunChangeSummary | undefined,
): string {
  const normalizedPrompt = normalizeWhitespace(prompt ?? '');
  if (normalizedPrompt) {
    const firstSentence = normalizedPrompt.split(/[\r\n.?!]/, 1)[0] ?? normalizedPrompt;
    const stripped = stripPromptLead(firstSentence);
    if (stripped) {
      return stripped
        .replace(/\b(the|a|an)\s+/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }
  }

  const fallback = summarizeFiles(summary);
  if (fallback) {
    return `update ${fallback}`.toLowerCase();
  }

  return 'update project changes';
}

export function buildProjectGitCommitMessageSuggestion(
  input: BuildCommitMessageSuggestionInput,
): ProjectGitCommitMessageSuggestion {
  const prompt = findTriggerMessageContent(input.session, input.run.triggerMessageId);
  const type = isCommitType(input.conventionalType)
    ? input.conventionalType
    : inferCommitTypeFromSummary(prompt, input.summary);
  const subject = buildSubject(prompt, input.summary);

  return {
    type,
    subject,
    message: `${type}: ${subject}`,
  };
}
