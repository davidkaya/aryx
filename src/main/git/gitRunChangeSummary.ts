import { Buffer } from 'node:buffer';
import { isUtf8 } from 'node:buffer';

import type {
  ProjectGitBaselineFile,
  ProjectGitDiffPreview,
  ProjectGitRunChangeCounts,
  ProjectGitRunChangeKind,
  ProjectGitRunChangeSummary,
  ProjectGitRunChangedFile,
  ProjectGitWorkingTreeFile,
  ProjectGitWorkingTreeSnapshot,
} from '@shared/domain/project';

interface DiffStats {
  additions: number;
  deletions: number;
}

interface BuildProjectGitRunChangeSummaryInput {
  generatedAt: string;
  preRunSnapshot?: ProjectGitWorkingTreeSnapshot;
  preRunBaselineFiles?: readonly ProjectGitBaselineFile[];
  postRunSnapshot?: ProjectGitWorkingTreeSnapshot;
  postRunBaselineFiles?: readonly ProjectGitBaselineFile[];
}

function parseDiffStats(diff: string | undefined): DiffStats {
  if (!diff) {
    return { additions: 0, deletions: 0 };
  }

  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function isBinaryDiff(diff: string | undefined): boolean {
  if (!diff) {
    return false;
  }

  return diff.includes('GIT binary patch') || diff.includes('Binary files ');
}

function decodeUtf8FromBase64(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const buffer = Buffer.from(value, 'base64');
  return isUtf8(buffer) ? buffer.toString('utf8') : undefined;
}

function canRestoreBaseline(
  baseline: ProjectGitBaselineFile | undefined,
): baseline is ProjectGitBaselineFile {
  return baseline !== undefined
    && (baseline.untrackedContentBase64 !== undefined || baseline.combinedDiff !== undefined);
}

function previewFromBaselineFile(
  file: Pick<ProjectGitWorkingTreeFile, 'path'>,
  baseline: ProjectGitBaselineFile | undefined,
): ProjectGitDiffPreview | undefined {
  if (!baseline) {
    return undefined;
  }

  if (baseline.untrackedContentBase64 !== undefined) {
    return {
      path: file.path,
      previousPath: baseline.previousPath,
      newFileContents: decodeUtf8FromBase64(baseline.untrackedContentBase64),
      ...(baseline.isBinary ? { isBinary: true } : {}),
    };
  }

  if (baseline.combinedDiff === undefined && baseline.isBinary !== true) {
    return undefined;
  }

  return {
    path: file.path,
    previousPath: baseline.previousPath,
    ...(baseline.combinedDiff && !isBinaryDiff(baseline.combinedDiff)
      ? { diff: baseline.combinedDiff }
      : {}),
    ...(baseline.isBinary || isBinaryDiff(baseline.combinedDiff) ? { isBinary: true } : {}),
  };
}

function sameWorkingTreeFile(
  left: ProjectGitWorkingTreeFile,
  right: ProjectGitWorkingTreeFile,
): boolean {
  return (
    left.path === right.path
    && left.previousPath === right.previousPath
    && left.stagedStatus === right.stagedStatus
    && left.unstagedStatus === right.unstagedStatus
    && left.isConflicted === right.isConflicted
  );
}

function sameBaselineFile(
  left: ProjectGitBaselineFile | undefined,
  right: ProjectGitBaselineFile | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.path === right.path
    && left.previousPath === right.previousPath
    && left.combinedDiff === right.combinedDiff
    && left.untrackedContentBase64 === right.untrackedContentBase64
    && left.isBinary === right.isBinary
  );
}

function createRunChangeCounts(): ProjectGitRunChangeCounts {
  return {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    typeChanged: 0,
    unmerged: 0,
    untracked: 0,
    cleaned: 0,
  };
}

function incrementRunChangeCount(
  counts: ProjectGitRunChangeCounts,
  kind: ProjectGitRunChangeKind,
): void {
  switch (kind) {
    case 'added':
      counts.added += 1;
      break;
    case 'modified':
      counts.modified += 1;
      break;
    case 'deleted':
      counts.deleted += 1;
      break;
    case 'renamed':
      counts.renamed += 1;
      break;
    case 'copied':
      counts.copied += 1;
      break;
    case 'type-changed':
      counts.typeChanged += 1;
      break;
    case 'unmerged':
      counts.unmerged += 1;
      break;
    case 'untracked':
      counts.untracked += 1;
      break;
    case 'cleaned':
      counts.cleaned += 1;
      break;
  }
}

function resolveRunChangeKind(file: ProjectGitWorkingTreeFile): ProjectGitRunChangeKind {
  if (file.isConflicted) {
    return 'unmerged';
  }

  return file.unstagedStatus ?? file.stagedStatus ?? 'modified';
}

function sortRunChangedFiles(
  left: ProjectGitRunChangedFile,
  right: ProjectGitRunChangedFile,
): number {
  if (left.origin !== right.origin) {
    return left.origin === 'run-created' ? -1 : 1;
  }

  return left.path.localeCompare(right.path);
}

export function buildProjectGitRunChangeSummary(
  input: BuildProjectGitRunChangeSummaryInput,
): ProjectGitRunChangeSummary | undefined {
  const {
    generatedAt,
    preRunSnapshot,
    preRunBaselineFiles,
    postRunSnapshot,
    postRunBaselineFiles,
  } = input;

  if (!preRunSnapshot || !postRunSnapshot) {
    return undefined;
  }

  const preRunFilesByPath = new Map(
    preRunSnapshot.files.map((file) => [file.path, file] satisfies [string, ProjectGitWorkingTreeFile]),
  );
  const preRunBaselineByPath = new Map(
    (preRunBaselineFiles ?? []).map((file) => [file.path, file] satisfies [string, ProjectGitBaselineFile]),
  );
  const postRunBaselineByPath = new Map(
    (postRunBaselineFiles ?? []).map((file) => [file.path, file] satisfies [string, ProjectGitBaselineFile]),
  );
  const matchedPreRunPaths = new Set<string>();
  const files: ProjectGitRunChangedFile[] = [];

  for (const postRunFile of postRunSnapshot.files) {
    const matchedPreRunFile = preRunFilesByPath.get(postRunFile.path)
      ?? (postRunFile.previousPath ? preRunFilesByPath.get(postRunFile.previousPath) : undefined);
    const matchedPreRunPath = matchedPreRunFile?.path;
    const postRunBaseline = postRunBaselineByPath.get(postRunFile.path);
    if (!matchedPreRunFile || !matchedPreRunPath) {
      const preview = previewFromBaselineFile(postRunFile, postRunBaseline);
      const stats = parseDiffStats(preview?.diff);
      files.push({
        path: postRunFile.path,
        previousPath: postRunFile.previousPath,
        kind: resolveRunChangeKind(postRunFile),
        origin: 'run-created',
        stagedStatus: postRunFile.stagedStatus,
        unstagedStatus: postRunFile.unstagedStatus,
        ...(postRunFile.isConflicted ? { isConflicted: true } : {}),
        additions: stats.additions,
        deletions: stats.deletions,
        canRevert: true,
        ...(preview ? { preview } : {}),
      });
      continue;
    }

    matchedPreRunPaths.add(matchedPreRunPath);

    const preRunBaseline = preRunBaselineByPath.get(matchedPreRunPath);
    if (sameWorkingTreeFile(matchedPreRunFile, postRunFile) && sameBaselineFile(preRunBaseline, postRunBaseline)) {
      continue;
    }

    const preview = previewFromBaselineFile(postRunFile, postRunBaseline);
    const stats = parseDiffStats(preview?.diff);
    files.push({
      path: postRunFile.path,
      previousPath: postRunFile.previousPath,
      kind: resolveRunChangeKind(postRunFile),
      origin: 'pre-existing',
      stagedStatus: postRunFile.stagedStatus,
      unstagedStatus: postRunFile.unstagedStatus,
      ...(postRunFile.isConflicted ? { isConflicted: true } : {}),
      additions: stats.additions,
      deletions: stats.deletions,
      canRevert: canRestoreBaseline(preRunBaseline),
      ...(preview ? { preview } : {}),
    });
  }

  for (const preRunFile of preRunSnapshot.files) {
    if (matchedPreRunPaths.has(preRunFile.path)) {
      continue;
    }

    const preRunBaseline = preRunBaselineByPath.get(preRunFile.path);
    const preview = previewFromBaselineFile(preRunFile, preRunBaseline);
    const stats = parseDiffStats(preview?.diff);
    files.push({
      path: preRunFile.path,
      previousPath: preRunFile.previousPath,
      kind: 'cleaned',
      origin: 'pre-existing',
      stagedStatus: preRunFile.stagedStatus,
      unstagedStatus: preRunFile.unstagedStatus,
      ...(preRunFile.isConflicted ? { isConflicted: true } : {}),
      additions: stats.additions,
      deletions: stats.deletions,
      canRevert: canRestoreBaseline(preRunBaseline),
      ...(preview ? { preview } : {}),
    });
  }

  const branchChanged = preRunSnapshot.branch !== postRunSnapshot.branch;
  if (files.length === 0 && !branchChanged) {
    return undefined;
  }

  files.sort(sortRunChangedFiles);
  const counts = createRunChangeCounts();
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    incrementRunChangeCount(counts, file.kind);
    additions += file.additions;
    deletions += file.deletions;
  }

  return {
    generatedAt,
    branchAtStart: preRunSnapshot.branch,
    branchAtEnd: postRunSnapshot.branch,
    ...(branchChanged ? { branchChanged: true } : {}),
    fileCount: files.length,
    additions,
    deletions,
    counts,
    files,
  };
}
