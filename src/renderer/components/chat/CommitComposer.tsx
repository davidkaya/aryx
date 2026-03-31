import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpFromLine,
  Check,
  ChevronRight,
  FileCode2,
  FileMinus2,
  FilePlus2,
  GitBranch,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';

import { getElectronApi } from '@renderer/lib/electronApi';
import type {
  ProjectGitCommitMessageSuggestion,
  ProjectGitConventionalCommitType,
  ProjectGitDetails,
  ProjectGitDiffPreview,
  ProjectGitFileReference,
  ProjectGitWorkingTreeFile,
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

function fileIcon(file: ProjectGitWorkingTreeFile) {
  if (file.stagedStatus === 'added' || file.unstagedStatus === 'untracked') {
    return <FilePlus2 className="size-3 shrink-0 text-[var(--color-status-success)]" />;
  }
  if (file.stagedStatus === 'deleted' || file.unstagedStatus === 'deleted') {
    return <FileMinus2 className="size-3 shrink-0 text-[var(--color-status-error)]" />;
  }
  return <FileCode2 className="size-3 shrink-0 text-[var(--color-accent-sky)]" />;
}

function statusLabel(file: ProjectGitWorkingTreeFile): string {
  return file.stagedStatus ?? file.unstagedStatus ?? 'modified';
}

const CONVENTIONAL_TYPES: { value: ProjectGitConventionalCommitType; label: string }[] = [
  { value: 'feat', label: 'feat' },
  { value: 'fix', label: 'fix' },
  { value: 'refactor', label: 'refactor' },
  { value: 'docs', label: 'docs' },
  { value: 'test', label: 'test' },
  { value: 'chore', label: 'chore' },
];

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

/* ── File row with staging checkbox ────────────────────────── */

function CommitFileRow({
  file,
  isStaged,
  onToggle,
  onPreview,
  preview,
  previewExpanded,
}: {
  file: ProjectGitWorkingTreeFile;
  isStaged: boolean;
  onToggle: () => void;
  onPreview: () => void;
  preview?: ProjectGitDiffPreview;
  previewExpanded: boolean;
}) {
  const dir = fileDir(file.path);
  const base = fileBaseName(file.path);
  const hasPreview = !!preview?.diff || !!preview?.newFileContents;

  return (
    <div className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      <div className="flex items-center gap-1 px-2.5 py-[5px] text-[10px]">
        {/* Staging checkbox */}
        <button
          className={`flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors duration-100 ${
            isStaged
              ? 'border-[var(--color-status-success)] bg-[var(--color-status-success)] text-white'
              : 'border-[var(--color-border)] bg-transparent hover:border-[var(--color-text-muted)]'
          }`}
          onClick={onToggle}
          type="button"
          aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${file.path}`}
          aria-pressed={isStaged}
        >
          {isStaged && <Check className="size-2" />}
        </button>

        {/* File path + expand */}
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors duration-150 hover:text-[var(--color-text-primary)]"
          onClick={onPreview}
          type="button"
          aria-expanded={previewExpanded}
        >
          {hasPreview || previewExpanded ? (
            <ChevronRight
              className={`size-2.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${previewExpanded ? 'rotate-90' : ''}`}
            />
          ) : (
            <span className="w-2.5 shrink-0" />
          )}

          {fileIcon(file)}

          <span className="min-w-0 flex-1 truncate font-mono">
            {dir && <span className="text-[var(--color-text-muted)]">{dir}</span>}
            <span className="text-[var(--color-text-primary)]">{base}</span>
          </span>

          <span className="shrink-0 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wider bg-[var(--color-surface-3)] text-[var(--color-text-muted)]">
            {statusLabel(file)}
          </span>
        </button>
      </div>

      {/* Diff preview */}
      {previewExpanded && preview && (
        <div className="border-t border-[var(--color-border-subtle)]">
          <pre className="max-h-52 overflow-auto bg-[var(--color-surface-0)] px-3 py-1.5 font-mono text-[10px] leading-relaxed">
            {preview.diff
              ? preview.diff.split('\n').map((line, i) => <DiffLine key={i} line={line} />)
              : preview.newFileContents
                ? preview.newFileContents.split('\n').map((line, i) => (
                    <div key={i} className="text-[var(--color-text-secondary)]">{line || '\u00A0'}</div>
                  ))
                : preview.isBinary
                  ? <div className="text-[var(--color-text-muted)] italic">Binary file</div>
                  : <div className="text-[var(--color-text-muted)] italic">Loading…</div>}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Main export ───────────────────────────────────────────── */

interface CommitComposerProps {
  projectId: string;
  sessionId: string;
  runId?: string;
  onClose: () => void;
}

export function CommitComposer({
  projectId,
  sessionId,
  runId,
  onClose,
}: CommitComposerProps) {
  const api = getElectronApi();

  const [details, setDetails] = useState<ProjectGitDetails>();
  const [loading, setLoading] = useState(true);
  const [commitMessage, setCommitMessage] = useState('');
  const [commitType, setCommitType] = useState<ProjectGitConventionalCommitType>('feat');
  const [stagedPaths, setStagedPaths] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, ProjectGitDiffPreview>>({});
  const [expandedPath, setExpandedPath] = useState<string>();
  const [committing, setCommitting] = useState(false);
  const [pushAfterCommit, setPushAfterCommit] = useState(false);
  const [commitError, setCommitError] = useState<string>();
  const [commitSuccess, setCommitSuccess] = useState(false);

  // Load git details on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const result = await api.getProjectGitDetails({ projectId });
        if (!cancelled) {
          setDetails(result);

          // Pre-stage files that are already in the index
          if (result.workingTree) {
            const preStaged = new Set<string>();
            for (const file of result.workingTree.files) {
              if (file.stagedStatus && file.stagedStatus !== 'unmerged') {
                preStaged.add(file.path);
              }
            }
            setStagedPaths(preStaged);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [api, projectId]);

  // Load commit message suggestion
  useEffect(() => {
    let cancelled = false;

    async function suggest() {
      try {
        const suggestion = await api.suggestProjectGitCommitMessage({
          sessionId,
          runId,
          conventionalType: commitType,
        });
        if (!cancelled && suggestion) {
          setCommitMessage(suggestion.message);
          setCommitType(suggestion.type);
        }
      } catch {
        // Suggestion is best-effort
      }
    }

    if (!commitMessage) {
      void suggest();
    }

    return () => { cancelled = true; };
  }, [api, sessionId, runId]); // Deliberately omitting commitType/commitMessage to avoid re-triggering

  const files = useMemo(
    () => details?.workingTree?.files ?? [],
    [details?.workingTree?.files],
  );

  const stagedFiles = useMemo(
    () => files.filter((f) => stagedPaths.has(f.path)),
    [files, stagedPaths],
  );

  const toggleStaged = useCallback((path: string) => {
    setStagedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (stagedPaths.size === files.length) {
      setStagedPaths(new Set());
    } else {
      setStagedPaths(new Set(files.map((f) => f.path)));
    }
  }, [files, stagedPaths.size]);

  const handlePreview = useCallback(async (file: ProjectGitWorkingTreeFile) => {
    if (expandedPath === file.path) {
      setExpandedPath(undefined);
      return;
    }

    setExpandedPath(file.path);

    if (!previews[file.path]) {
      try {
        const preview = await api.getProjectGitFilePreview({
          projectId,
          file: { path: file.path, previousPath: file.previousPath },
        });
        if (preview) {
          setPreviews((prev) => ({ ...prev, [file.path]: preview }));
        }
      } catch {
        // Preview is best-effort
      }
    }
  }, [api, expandedPath, previews, projectId]);

  const handleSuggestMessage = useCallback(async () => {
    try {
      const suggestion = await api.suggestProjectGitCommitMessage({
        sessionId,
        runId,
        conventionalType: commitType,
      });
      if (suggestion) {
        setCommitMessage(suggestion.message);
        setCommitType(suggestion.type);
      }
    } catch {
      // Best-effort
    }
  }, [api, sessionId, runId, commitType]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || stagedFiles.length === 0) return;

    setCommitting(true);
    setCommitError(undefined);
    try {
      const filesToCommit: ProjectGitFileReference[] = stagedFiles.map((f) => ({
        path: f.path,
        previousPath: f.previousPath,
      }));
      await api.commitProjectGitChanges({
        projectId,
        message: commitMessage.trim(),
        files: filesToCommit,
        push: pushAfterCommit,
      });
      setCommitSuccess(true);
      setTimeout(() => onClose(), 1200);
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitting(false);
    }
  }, [api, commitMessage, onClose, projectId, pushAfterCommit, stagedFiles]);

  // Keyboard: Escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commit-composer-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 flex w-[420px] max-w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <GitBranch className="size-4 text-[var(--color-accent-sky)]" />
          <h2 id="commit-composer-title" className="font-display text-sm font-semibold text-[var(--color-text-primary)]">
            Commit Changes
          </h2>
          {details?.context.branch && (
            <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
              on {details.context.branch}
            </span>
          )}
          <div className="flex-1" />
          <button
            className="rounded-md p-1 text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
            onClick={onClose}
            type="button"
            aria-label="Close commit composer"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-[var(--color-text-muted)]" aria-label="Loading git details" />
          </div>
        )}

        {/* Success state */}
        {commitSuccess && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
            <div className="flex size-12 items-center justify-center rounded-full bg-[var(--color-status-success)]/10">
              <Check className="size-6 text-[var(--color-status-success)]" />
            </div>
            <p className="text-sm font-medium text-[var(--color-status-success)]">
              Changes committed{pushAfterCommit ? ' and pushed' : ''}
            </p>
          </div>
        )}

        {/* Content */}
        {!loading && !commitSuccess && (
          <>
            {/* Commit message */}
            <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
              {/* Type selector */}
              <div className="mb-2 flex items-center gap-1">
                {CONVENTIONAL_TYPES.map((ct) => (
                  <button
                    key={ct.value}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors duration-100 ${
                      commitType === ct.value
                        ? 'bg-[var(--color-accent)]/15 text-[var(--color-text-accent)]'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]'
                    }`}
                    onClick={() => setCommitType(ct.value)}
                    type="button"
                  >
                    {ct.label}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-accent)]"
                  onClick={() => void handleSuggestMessage()}
                  type="button"
                  title="Suggest commit message"
                >
                  <Sparkles className="size-3" />
                  Suggest
                </button>
              </div>

              <textarea
                className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
                placeholder="Commit message…"
                rows={3}
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
              />
            </div>

            {/* File list */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Select all header */}
              <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-2.5 py-1.5">
                <button
                  className={`flex size-3.5 shrink-0 items-center justify-center rounded border transition-colors duration-100 ${
                    stagedPaths.size === files.length && files.length > 0
                      ? 'border-[var(--color-status-success)] bg-[var(--color-status-success)] text-white'
                      : 'border-[var(--color-border)] bg-transparent hover:border-[var(--color-text-muted)]'
                  }`}
                  onClick={toggleAll}
                  type="button"
                  aria-label={stagedPaths.size === files.length ? 'Unstage all' : 'Stage all'}
                >
                  {stagedPaths.size === files.length && files.length > 0 && <Check className="size-2" />}
                </button>
                <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
                  {stagedPaths.size} of {files.length} staged
                </span>
              </div>

              {files.length === 0 ? (
                <p className="px-4 py-6 text-center text-[11px] text-[var(--color-text-muted)]">
                  Working tree is clean — nothing to commit.
                </p>
              ) : (
                files.map((file) => (
                  <CommitFileRow
                    file={file}
                    isStaged={stagedPaths.has(file.path)}
                    key={file.path}
                    onPreview={() => void handlePreview(file)}
                    onToggle={() => toggleStaged(file.path)}
                    preview={previews[file.path]}
                    previewExpanded={expandedPath === file.path}
                  />
                ))
              )}
            </div>

            {/* Error */}
            {commitError && (
              <div className="border-t border-[var(--color-status-error)]/20 bg-[var(--color-status-error)]/5 px-4 py-2 text-[10px] text-[var(--color-status-error)]" role="alert">
                {commitError}
              </div>
            )}

            {/* Footer actions */}
            <div className="flex items-center gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
              {/* Push toggle */}
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                <input
                  type="checkbox"
                  checked={pushAfterCommit}
                  onChange={(e) => setPushAfterCommit(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Push after commit
              </label>

              <div className="flex-1" />

              <button
                className="rounded-md px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-muted)] transition-colors duration-100 hover:bg-[var(--color-surface-3)]"
                onClick={onClose}
                type="button"
              >
                Cancel
              </button>
              <button
                className="flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[11px] font-medium text-white transition-colors duration-150 hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={committing || !commitMessage.trim() || stagedFiles.length === 0}
                onClick={() => void handleCommit()}
                type="button"
              >
                {committing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="size-3" />
                )}
                {committing ? 'Committing…' : pushAfterCommit ? 'Commit & Push' : 'Commit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
