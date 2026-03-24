import { useEffect, useMemo, useState } from 'react';
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

  const canCreate = projectId && patternId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-[13px] font-semibold text-zinc-100">New Session</h2>
          <button
            className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-5">
          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-zinc-400">Project</span>
            <select
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-100 outline-none transition focus:border-indigo-500/50"
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
            <span className="text-[12px] font-medium text-zinc-400">Pattern</span>
            <div className="space-y-1 rounded-lg border border-zinc-700 bg-zinc-950 p-1.5">
              {availablePatterns.map((p) => (
                <div
                  key={p.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition ${
                    patternId === p.id
                      ? 'bg-indigo-500/15 text-zinc-100 ring-1 ring-indigo-500/25'
                      : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                  onClick={() => setPatternId(p.id)}
                >
                  <span className="flex-1 truncate">
                    {p.name}
                    <span className="ml-1.5 text-[11px] text-zinc-500">({p.mode})</span>
                  </span>
                  {onTogglePatternFavorite && (
                    <button
                      className={`shrink-0 transition ${
                        p.isFavorite
                          ? 'text-amber-400 hover:text-amber-300'
                          : 'text-zinc-700 hover:text-zinc-400'
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
              <p className="text-[12px] text-zinc-600">
                {availablePatterns.find((p) => p.id === patternId)?.description}
              </p>
            )}
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            className="rounded-lg px-4 py-1.5 text-[13px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
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
