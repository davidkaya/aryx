import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronRight,
  FileCode2,
  FileMinus2,
  FilePlus2,
  GitBranch,
  Loader2,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import type {
  ProjectGitFileReference,
  ProjectGitRunChangedFile,
  ProjectGitRunChangeSummary,
} from '@shared/domain/project';

/* ── Helpers ───────────────────────────────────────────────── */

function fileBaseName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function fileDir(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.slice(0, lastSlash + 1) : '';
}

function kindLabel(kind: ProjectGitRunChangedFile['kind']): string {
  switch (kind) {
    case 'added': return 'added';
    case 'modified': return 'modified';
    case 'deleted': return 'deleted';
    case 'renamed': return 'renamed';
    case 'copied': return 'copied';
    case 'type-changed': return 'type changed';
    case 'unmerged': return 'conflict';
    case 'untracked': return 'new';
    case 'cleaned': return 'cleaned';
  }
}

function kindIcon(kind: ProjectGitRunChangedFile['kind']) {
  switch (kind) {
    case 'added':
    case 'untracked':
    case 'copied':
      return <FilePlus2 className="size-3 shrink-0 text-[var(--color-status-success)]" />;
    case 'deleted':
    case 'cleaned':
      return <FileMinus2 className="size-3 shrink-0 text-[var(--color-status-error)]" />;
    default:
      return <FileCode2 className="size-3 shrink-0 text-[var(--color-accent-sky)]" />;
  }
}

function originBadge(origin: ProjectGitRunChangedFile['origin']) {
  if (origin === 'pre-existing') {
    return (
      <span className="rounded px-1 py-px text-[7px] font-semibold uppercase tracking-wider bg-[var(--color-status-warning)]/10 text-[var(--color-status-warning)]">
        pre-existing
      </span>
    );
  }

  return null;
}

/* ── Mini diff-stats bar ───────────────────────────────────── */

function DiffStatsBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const blocks = 5;
  const addBlocks = Math.max(additions > 0 ? 1 : 0, Math.round((additions / total) * blocks));
  const delBlocks = blocks - addBlocks;

  return (
    <span className="inline-flex gap-px" aria-label={`${additions} additions, ${deletions} deletions`}>
      {Array.from({ length: addBlocks }, (_, i) => (
        <span key={`a${i}`} className="size-1.5 rounded-[1px] bg-[var(--color-status-success)]" />
      ))}
      {Array.from({ length: delBlocks }, (_, i) => (
        <span key={`d${i}`} className="size-1.5 rounded-[1px] bg-[var(--color-status-error)]" />
      ))}
    </span>
  );
}

/* ── Diff line renderer ────────────────────────────────────── */

function DiffLine({ line }: { line: string }) {
  let textClass = 'text-[var(--color-text-secondary)]';
  let bgClass = '';

  if (line.startsWith('+') && !line.startsWith('+++')) {
    textClass = 'text-[var(--color-status-success)]';
    bgClass = 'bg-[var(--color-status-success)]/[0.06]';
  } else if (line.startsWith('-') && !line.startsWith('---')) {
    textClass = 'text-[var(--color-status-error)]';
    bgClass = 'bg-[var(--color-status-error)]/[0.06]';
  } else if (line.startsWith('@@')) {
    textClass = 'text-[var(--color-accent-sky)]';
  } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
    textClass = 'text-[var(--color-text-muted)]';
  }

  return <div className={`${textClass} ${bgClass} -mx-3 px-3`}>{line || '\u00A0'}</div>;
}

/* ── Single file row ───────────────────────────────────────── */

function ChangedFileRow({
  file,
  isSelected,
  onToggleSelect,
  canSelect,
}: {
  file: ProjectGitRunChangedFile;
  isSelected: boolean;
  onToggleSelect: () => void;
  canSelect: boolean;
}) {
  const [diffExpanded, setDiffExpanded] = useState(false);
  const hasPreview = !!file.preview?.diff || !!file.preview?.newFileContents;
  const dir = fileDir(file.path);
  const base = fileBaseName(file.path);

  return (
    <div className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      <div className="flex items-center gap-1 px-2 py-[5px] text-[10px]">
        {/* Select checkbox */}
        {canSelect && (
          <button
            className={`flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors duration-100 ${
              isSelected
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                : 'border-[var(--color-border)] bg-transparent hover:border-[var(--color-text-muted)]'
            }`}
            onClick={onToggleSelect}
            type="button"
            aria-label={`${isSelected ? 'Deselect' : 'Select'} ${file.path}`}
            aria-pressed={isSelected}
          >
            {isSelected && <Check className="size-2" />}
          </button>
        )}

        {/* Expand diff button */}
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors duration-150 hover:bg-[var(--color-surface-3)]/40 disabled:cursor-default"
          disabled={!hasPreview}
          onClick={hasPreview ? () => setDiffExpanded(!diffExpanded) : undefined}
          type="button"
          aria-expanded={hasPreview ? diffExpanded : undefined}
        >
          {hasPreview ? (
            <ChevronRight
              className={`size-2.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${diffExpanded ? 'rotate-90' : ''}`}
            />
          ) : (
            <span className="w-2.5 shrink-0" />
          )}

          {kindIcon(file.kind)}

          <span className="min-w-0 flex-1 truncate font-mono">
            {dir && <span className="text-[var(--color-text-muted)]">{dir}</span>}
            <span className="text-[var(--color-text-primary)]">{base}</span>
          </span>

          <span className="shrink-0 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wider bg-[var(--color-surface-3)] text-[var(--color-text-muted)]">
            {kindLabel(file.kind)}
          </span>

          {originBadge(file.origin)}

          {(file.additions > 0 || file.deletions > 0) && (
            <span className="flex items-center gap-1.5 shrink-0 font-mono">
              {file.additions > 0 && <span className="text-[var(--color-status-success)]">+{file.additions}</span>}
              {file.deletions > 0 && <span className="text-[var(--color-status-error)]">−{file.deletions}</span>}
              <DiffStatsBar additions={file.additions} deletions={file.deletions} />
            </span>
          )}
        </button>
      </div>

      {/* Diff preview */}
      {diffExpanded && file.preview && (
        <div className="border-t border-[var(--color-border-subtle)]">
          <pre className="max-h-64 overflow-auto bg-[var(--color-surface-0)] px-3 py-1.5 font-mono text-[10px] leading-relaxed">
            {file.preview.diff
              ? file.preview.diff.split('\n').map((line, i) => <DiffLine key={i} line={line} />)
              : file.preview.newFileContents
                ? file.preview.newFileContents.split('\n').map((line, i) => (
                    <div key={i} className="text-[var(--color-text-secondary)]">{line || '\u00A0'}</div>
                  ))
                : file.preview.isBinary
                  ? <div className="text-[var(--color-text-muted)] italic">Binary file</div>
                  : null}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Main export ───────────────────────────────────────────── */

interface RunChangeSummaryCardProps {
  summary: ProjectGitRunChangeSummary;
  sessionId: string;
  runId: string;
  onDiscard: (sessionId: string, runId: string, files?: ProjectGitFileReference[]) => Promise<unknown>;
  onOpenCommitComposer?: () => void;
}

export function RunChangeSummaryCard({
  summary,
  sessionId,
  runId,
  onDiscard,
  onOpenCommitComposer,
}: RunChangeSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [discarding, setDiscarding] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<'bulk' | 'selected' | undefined>();

  const revertableFiles = useMemo(
    () => summary.files.filter((file) => file.canRevert),
    [summary.files],
  );
  const hasRevertable = revertableFiles.length > 0;

  const toggleSelect = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleDiscard = useCallback(async (mode: 'bulk' | 'selected') => {
    setDiscarding(true);
    try {
      if (mode === 'selected') {
        const files: ProjectGitFileReference[] = summary.files
          .filter((f) => selectedPaths.has(f.path))
          .map((f) => ({ path: f.path, previousPath: f.previousPath }));
        await onDiscard(sessionId, runId, files);
        setSelectedPaths(new Set());
      } else {
        await onDiscard(sessionId, runId);
      }
    } finally {
      setDiscarding(false);
      setConfirmDiscard(undefined);
    }
  }, [onDiscard, sessionId, runId, selectedPaths, summary.files]);

  const selectedRevertableCount = useMemo(
    () => revertableFiles.filter((f) => selectedPaths.has(f.path)).length,
    [revertableFiles, selectedPaths],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]/80">
      {/* Header */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--color-surface-2)]/40"
        onClick={() => setExpanded(!expanded)}
        type="button"
        aria-expanded={expanded}
        aria-label={`${summary.fileCount} files changed by this run`}
      >
        <ChevronRight
          className={`size-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />

        <GitBranch className="size-3 shrink-0 text-[var(--color-accent-sky)]" />

        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
          {summary.fileCount} {summary.fileCount === 1 ? 'file' : 'files'} changed
        </span>

        {(summary.additions > 0 || summary.deletions > 0) && (
          <span className="flex items-center gap-1.5 font-mono text-[10px]">
            {summary.additions > 0 && (
              <span className="text-[var(--color-status-success)]">+{summary.additions}</span>
            )}
            {summary.deletions > 0 && (
              <span className="text-[var(--color-status-error)]">−{summary.deletions}</span>
            )}
            <DiffStatsBar additions={summary.additions} deletions={summary.deletions} />
          </span>
        )}

        {summary.branchChanged && (
          <span className="ml-auto flex items-center gap-1 text-[9px] text-[var(--color-status-warning)]">
            <AlertTriangle className="size-2.5" />
            branch changed
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)]">
          {/* Branch info */}
          {summary.branchChanged && summary.branchAtStart && summary.branchAtEnd && (
            <div className="flex items-center gap-1.5 border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-[9px] text-[var(--color-text-muted)]">
              <GitBranch className="size-2.5" />
              <span className="font-mono text-[var(--color-text-secondary)]">{summary.branchAtStart}</span>
              <span>→</span>
              <span className="font-mono text-[var(--color-text-secondary)]">{summary.branchAtEnd}</span>
            </div>
          )}

          {/* File list */}
          <div>
            {summary.files.map((file) => (
              <ChangedFileRow
                canSelect={hasRevertable && file.canRevert}
                file={file}
                isSelected={selectedPaths.has(file.path)}
                key={file.path}
                onToggleSelect={() => toggleSelect(file.path)}
              />
            ))}
          </div>

          {/* Actions */}
          {(hasRevertable || onOpenCommitComposer) && (
            <div className="flex items-center gap-2 border-t border-[var(--color-border-subtle)] px-3 py-2">
              {/* Commit button */}
              {onOpenCommitComposer && (
                <button
                  className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[10px] font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)]"
                  onClick={onOpenCommitComposer}
                  type="button"
                >
                  <ArrowDownToLine className="size-3" />
                  Commit changes
                </button>
              )}

              <div className="flex-1" />

              {/* Discard actions */}
              {hasRevertable && !confirmDiscard && (
                <>
                  {selectedRevertableCount > 0 && (
                    <button
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-[var(--color-status-error)] transition-colors duration-150 hover:bg-[var(--color-status-error)]/10"
                      disabled={discarding}
                      onClick={() => setConfirmDiscard('selected')}
                      type="button"
                    >
                      <Trash2 className="size-3" />
                      Discard {selectedRevertableCount} selected
                    </button>
                  )}
                  <button
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-status-error)]"
                    disabled={discarding}
                    onClick={() => setConfirmDiscard('bulk')}
                    type="button"
                  >
                    <RotateCcw className="size-3" />
                    Discard all
                  </button>
                </>
              )}

              {/* Confirmation */}
              {confirmDiscard && (
                <div className="flex items-center gap-1.5 rounded-md border border-[var(--color-status-error)]/30 bg-[var(--color-status-error)]/5 px-2.5 py-1" role="alert">
                  <AlertTriangle className="size-3 text-[var(--color-status-error)]" />
                  <span className="text-[10px] text-[var(--color-status-error)]">
                    {confirmDiscard === 'bulk'
                      ? `Revert all ${revertableFiles.length} files to pre-run state?`
                      : `Revert ${selectedRevertableCount} selected files?`}
                  </span>
                  <button
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-status-error)] transition-colors duration-100 hover:bg-[var(--color-status-error)]/15"
                    disabled={discarding}
                    onClick={() => void handleDiscard(confirmDiscard)}
                    type="button"
                  >
                    {discarding ? <Loader2 className="size-2.5 animate-spin" /> : <Check className="size-2.5" />}
                    Yes
                  </button>
                  <button
                    className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)]"
                    onClick={() => setConfirmDiscard(undefined)}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
