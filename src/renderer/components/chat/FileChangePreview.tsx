import { useState, useMemo } from 'react';
import { ChevronRight, FileCode2, FilePlus2 } from 'lucide-react';

import type { ToolCallFileChangePreview } from '@shared/contracts/sidecar';

/* ── Diff stat helpers ─────────────────────────────────────── */

interface DiffStats {
  additions: number;
  deletions: number;
}

function parseDiffStats(diff: string | undefined): DiffStats {
  if (!diff) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

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

/* ── Mini diff-stats bar (GitHub-style) ────────────────────── */

function DiffStatsBar({ additions, deletions }: DiffStats) {
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

/* ── Individual file entry ─────────────────────────────────── */

function FileChangeEntry({ file }: { file: ToolCallFileChangePreview }) {
  const [expanded, setExpanded] = useState(false);
  const isNewFile = !file.diff && !!file.newFileContents;
  const stats = useMemo(() => parseDiffStats(file.diff), [file.diff]);
  const hasContent = !!file.diff || !!file.newFileContents;
  const dir = fileDir(file.path);
  const base = fileBaseName(file.path);

  return (
    <div className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-[5px] text-left text-[10px] transition-colors duration-150 hover:bg-[var(--color-surface-3)]/40 disabled:cursor-default"
        disabled={!hasContent}
        onClick={hasContent ? () => setExpanded(!expanded) : undefined}
        type="button"
        aria-expanded={hasContent ? expanded : undefined}
      >
        {hasContent ? (
          <ChevronRight
            className={`size-2.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="w-2.5 shrink-0" />
        )}

        {isNewFile
          ? <FilePlus2 className="size-3 shrink-0 text-[var(--color-status-success)]" />
          : <FileCode2 className="size-3 shrink-0 text-[var(--color-accent-sky)]" />}

        <span className="min-w-0 flex-1 truncate font-mono">
          {dir && <span className="text-[var(--color-text-muted)]">{dir}</span>}
          <span className="text-[var(--color-text-primary)]">{base}</span>
        </span>

        {isNewFile ? (
          <span className="shrink-0 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wider bg-[var(--color-status-success)]/10 text-[var(--color-status-success)]">
            new
          </span>
        ) : (stats.additions > 0 || stats.deletions > 0) ? (
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="flex items-center gap-0.5 font-mono">
              {stats.additions > 0 && <span className="text-[var(--color-status-success)]">+{stats.additions}</span>}
              {stats.deletions > 0 && <span className="text-[var(--color-status-error)]">−{stats.deletions}</span>}
            </span>
            <DiffStatsBar additions={stats.additions} deletions={stats.deletions} />
          </span>
        ) : null}
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)]">
          <pre className="max-h-64 overflow-auto bg-[var(--color-surface-0)] px-3 py-1.5 font-mono text-[10px] leading-relaxed">
            {file.diff
              ? file.diff.split('\n').map((line, i) => <DiffLine key={i} line={line} />)
              : file.newFileContents!.split('\n').map((line, i) => (
                  <div key={i} className="text-[var(--color-text-secondary)]">{line || '\u00A0'}</div>
                ))}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Main export ───────────────────────────────────────────── */

interface FileChangePreviewProps {
  fileChanges: ToolCallFileChangePreview[];
}

export function FileChangePreview({ fileChanges }: FileChangePreviewProps) {
  const [expanded, setExpanded] = useState(false);

  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let newFiles = 0;
    for (const fc of fileChanges) {
      if (!fc.diff && fc.newFileContents) {
        newFiles++;
      } else {
        const s = parseDiffStats(fc.diff);
        additions += s.additions;
        deletions += s.deletions;
      }
    }
    return { additions, deletions, newFiles };
  }, [fileChanges]);

  const fileWord = fileChanges.length === 1 ? 'file' : 'files';

  return (
    <div className="mt-1 overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/60">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] font-medium text-[var(--color-text-muted)] transition-colors duration-150 hover:bg-[var(--color-surface-2)]/40 hover:text-[var(--color-text-secondary)]"
        onClick={() => setExpanded(!expanded)}
        type="button"
        aria-expanded={expanded}
        aria-label={`${fileChanges.length} file changes`}
      >
        <ChevronRight
          className={`size-2.5 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <span>{fileChanges.length} {fileWord} changed</span>

        {(totalStats.additions > 0 || totalStats.deletions > 0) && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono">
            {totalStats.additions > 0 && (
              <span className="text-[var(--color-status-success)]">+{totalStats.additions}</span>
            )}
            {totalStats.deletions > 0 && (
              <span className="text-[var(--color-status-error)]">−{totalStats.deletions}</span>
            )}
            <DiffStatsBar additions={totalStats.additions} deletions={totalStats.deletions} />
          </span>
        )}
        {totalStats.newFiles > 0 && (
          <span className={`shrink-0 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wider bg-[var(--color-status-success)]/10 text-[var(--color-status-success)] ${totalStats.additions === 0 && totalStats.deletions === 0 ? 'ml-auto' : ''}`}>
            {totalStats.newFiles} new
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)]">
          {fileChanges.map((fc) => (
            <FileChangeEntry file={fc} key={fc.path} />
          ))}
        </div>
      )}
    </div>
  );
}
