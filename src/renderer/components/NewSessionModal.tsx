import { useState } from 'react';
import { X } from 'lucide-react';

import type { PatternDefinition } from '@shared/domain/pattern';
import type { ProjectRecord } from '@shared/domain/project';

interface NewSessionModalProps {
  projects: ProjectRecord[];
  patterns: PatternDefinition[];
  defaultProjectId?: string;
  onClose: () => void;
  onCreate: (projectId: string, patternId: string) => void;
}

export function NewSessionModal({
  projects,
  patterns,
  defaultProjectId,
  onClose,
  onCreate,
}: NewSessionModalProps) {
  const availablePatterns = patterns.filter((p) => p.availability !== 'unavailable');
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '');
  const [patternId, setPatternId] = useState(availablePatterns[0]?.id ?? '');

  const canCreate = projectId && patternId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">New Session</h2>
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
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-zinc-400">Pattern</span>
            <select
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-100 outline-none transition focus:border-indigo-500/50"
              onChange={(e) => setPatternId(e.target.value)}
              value={patternId}
            >
              {availablePatterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.mode})
                </option>
              ))}
            </select>
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
