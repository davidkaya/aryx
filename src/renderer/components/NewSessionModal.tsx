import { useCallback, useEffect, useMemo, useState } from 'react';
import { Star, X } from 'lucide-react';

import type { PatternDefinition } from '@shared/domain/pattern';
import { isScratchpadProject, type ProjectRecord } from '@shared/domain/project';

interface NewSessionModalProps {
  projects: ProjectRecord[];
  patterns: PatternDefinition[];
  defaultProjectId?: string;
  onClose: () => void;
  onCreate: (projectId: string, patternId: string) => void;
  onTogglePatternFavorite?: (patternId: string, isFavorite: boolean) => void;
}

export function NewSessionModal({
  projects,
  patterns,
  defaultProjectId,
  onClose,
  onCreate,
  onTogglePatternFavorite,
}: NewSessionModalProps) {
  const userProjects = useMemo(
    () => projects.filter((p) => !isScratchpadProject(p)),
    [projects],
  );
  const [projectId, setProjectId] = useState(defaultProjectId ?? userProjects[0]?.id ?? '');
  const availablePatterns = useMemo(
    () =>
      patterns
        .filter((pattern) => pattern.availability !== 'unavailable')
        .sort((a, b) => {
          if (a.isFavorite && !b.isFavorite) return -1;
          if (!a.isFavorite && b.isFavorite) return 1;
          return 0;
        }),
    [patterns],
  );
  const [patternId, setPatternId] = useState(availablePatterns[0]?.id ?? '');

  useEffect(() => {
    if (!availablePatterns.some((pattern) => pattern.id === patternId)) {
      setPatternId(availablePatterns[0]?.id ?? '');
    }
  }, [availablePatterns, patternId]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const canCreate = projectId && patternId;

  return (
    <div className="overlay-backdrop-enter fixed inset-0 z-50 flex items-center justify-center bg-[#07080e]/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="new-session-title">
      <div className="overlay-panel-enter w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-[0_16px_64px_rgba(0,0,0,0.5)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 id="new-session-title" className="font-display text-[13px] font-semibold text-[var(--color-text-primary)]">New Session</h2>
          <button
            className="flex size-7 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-5">
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Project</span>
            <select
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none transition focus:border-[var(--color-accent)]/50"
              onChange={(e) => setProjectId(e.target.value)}
              value={projectId}
            >
              {userProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">Pattern</span>
            <div className="space-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] p-1.5">
              {availablePatterns.map((p) => (
                <div
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition ${
                    patternId === p.id
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)] ring-1 ring-[var(--color-border-glow)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-glass-hover)]'
                  }`}
                  onClick={() => setPatternId(p.id)}
                >
                  <span className="flex-1 truncate">
                    {p.name}
                    <span className="ml-1.5 text-[11px] text-[var(--color-text-muted)]">({p.mode})</span>
                  </span>
                  {onTogglePatternFavorite && (
                    <button
                      className={`shrink-0 transition ${
                        p.isFavorite
                          ? 'text-[var(--color-status-warning)] hover:text-[var(--color-status-warning)]'
                          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePatternFavorite(p.id, !p.isFavorite);
                      }}
                      title={p.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      type="button"
                    >
                      <Star className={`size-3.5 ${p.isFavorite ? 'fill-current' : ''}`} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {patternId && (
              <p className="text-[12px] text-[var(--color-text-muted)]">
                {availablePatterns.find((p) => p.id === patternId)?.description}
              </p>
            )}
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button
            className="rounded-lg px-4 py-1.5 text-[13px] text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-[var(--color-accent)] px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-[var(--color-accent-sky)] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canCreate}
            onClick={() => canCreate && onCreate(projectId, patternId)}
            type="button"
          >
            Start Session
          </button>
        </div>
      </div>
    </div>
  );
}
