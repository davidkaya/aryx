import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Bot,
  Layers,
  MessageCircle,
  Route,
  Search,
  Star,
  User,
} from 'lucide-react';

import type { WorkflowDefinition, WorkflowOrchestrationMode } from '@shared/domain/workflow';
import { inferWorkflowOrchestrationMode } from '@shared/domain/workflow';
import { useClickOutside } from '@renderer/hooks/useClickOutside';

/* ── Mode visual metadata ──────────────────────────────────── */

const modeMeta: Record<WorkflowOrchestrationMode, {
  label: string;
  icon: typeof Bot;
  accent: string;
  bg: string;
}> = {
  single: { label: 'Single', icon: User, accent: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  sequential: { label: 'Sequential', icon: ArrowRightLeft, accent: 'text-sky-400', bg: 'bg-sky-400/10' },
  concurrent: { label: 'Concurrent', icon: Layers, accent: 'text-amber-400', bg: 'bg-amber-400/10' },
  handoff: { label: 'Handoff', icon: Route, accent: 'text-violet-400', bg: 'bg-violet-400/10' },
  'group-chat': { label: 'Group Chat', icon: MessageCircle, accent: 'text-rose-400', bg: 'bg-rose-400/10' },
};

const modeOrder: WorkflowOrchestrationMode[] = ['single', 'sequential', 'concurrent', 'handoff', 'group-chat'];

/* ── Types ─────────────────────────────────────────────────── */

interface WorkflowPickerProps {
  workflows: ReadonlyArray<WorkflowDefinition>;
  onSelect: (workflowId: string) => void;
  onClose: () => void;
}

interface AnnotatedWorkflow {
  workflow: WorkflowDefinition;
  mode: WorkflowOrchestrationMode;
  agentCount: number;
}

/* ── Helpers ───────────────────────────────────────────────── */

function annotateWorkflow(workflow: WorkflowDefinition): AnnotatedWorkflow {
  const mode = inferWorkflowOrchestrationMode(workflow);
  const agentCount = workflow.graph.nodes.filter((n) => n.kind === 'agent').length;
  return { workflow, mode, agentCount };
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/* ── Component ─────────────────────────────────────────────── */

export function WorkflowPicker({ workflows, onSelect, onClose }: WorkflowPickerProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useClickOutside<HTMLDivElement>(onClose, true);

  // Annotate and group workflows
  const annotated = useMemo(
    () => workflows.map(annotateWorkflow),
    [workflows],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return annotated;
    return annotated.filter((a) =>
      fuzzyMatch(query, a.workflow.name)
      || fuzzyMatch(query, a.workflow.description)
      || fuzzyMatch(query, modeMeta[a.mode].label),
    );
  }, [annotated, query]);

  // Group by mode, preserving order
  const groups = useMemo(() => {
    const map = new Map<WorkflowOrchestrationMode, AnnotatedWorkflow[]>();
    for (const item of filtered) {
      const existing = map.get(item.mode);
      if (existing) {
        existing.push(item);
      } else {
        map.set(item.mode, [item]);
      }
    }
    return modeOrder
      .filter((mode) => map.has(mode))
      .map((mode) => ({ mode, items: map.get(mode)! }));
  }, [filtered]);

  // Flat list of items for keyboard navigation
  const flatItems = useMemo(
    () => groups.flatMap((g) => g.items),
    [groups],
  );

  // Clamp active index on filter change
  useEffect(() => {
    setActiveIndex((prev) => Math.min(prev, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll active item into view
  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (flatItems[activeIndex]) {
            onSelect(flatItems[activeIndex].workflow.id);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatItems, activeIndex, onSelect, onClose],
  );

  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Select a workflow"
    >
      <div
        ref={panelRef}
        className="w-full max-w-[420px] animate-[palette-enter_0.18s_ease-out] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-[0_24px_80px_rgba(0,0,0,0.45),0_0_0_1px_rgba(36,92,249,0.08)]"
        onKeyDown={handleKeyDown}
      >
        {/* Search bar */}
        <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-3">
          <Search className="size-4 shrink-0 text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-[14px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            placeholder="Pick a workflow…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            aria-label="Search workflows"
          />
          <kbd className="hidden rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] sm:inline">
            esc
          </kbd>
        </div>

        {/* Workflow list */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto overscroll-contain py-1.5" role="listbox">
          {groups.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-muted)]">
              No workflows match your search.
            </div>
          )}

          {groups.map((group) => {
            const meta = modeMeta[group.mode];
            const GroupIcon = meta.icon;

            return (
              <div key={group.mode}>
                {/* Group header */}
                <div className="flex items-center gap-2 px-4 pb-1 pt-2.5">
                  <GroupIcon className={`size-3 ${meta.accent}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
                    {meta.label}
                  </span>
                </div>

                {/* Items */}
                {group.items.map((item) => {
                  const isActive = flatIdx === activeIndex;
                  const currentIdx = flatIdx;
                  flatIdx++;

                  return (
                    <button
                      key={item.workflow.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 ${
                        isActive
                          ? 'bg-[var(--color-accent-muted)]'
                          : 'hover:bg-[var(--color-surface-2)]'
                      }`}
                      onClick={() => onSelect(item.workflow.id)}
                      onMouseEnter={() => setActiveIndex(currentIdx)}
                    >
                      {/* Mode badge */}
                      <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${meta.bg}`}>
                        <GroupIcon className={`size-3.5 ${meta.accent}`} />
                      </div>

                      {/* Name + description */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`truncate text-[13px] font-medium ${
                            isActive ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'
                          }`}>
                            {item.workflow.name}
                          </span>
                          {item.workflow.isFavorite && (
                            <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                          )}
                        </div>
                        {item.workflow.description && (
                          <p className="truncate text-[11px] text-[var(--color-text-muted)]">
                            {item.workflow.description}
                          </p>
                        )}
                      </div>

                      {/* Agent count pill */}
                      <div className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--color-surface-3)] px-1.5 py-0.5">
                        <Bot className="size-2.5 text-[var(--color-text-muted)]" />
                        <span className="text-[10px] font-medium text-[var(--color-text-muted)]">
                          {item.agentCount}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-[var(--color-border)] px-4 py-2">
          <span className="text-[11px] text-[var(--color-text-muted)]">
            <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] px-1 py-px text-[10px]">↑↓</kbd>
            {' '}navigate
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-3)] px-1 py-px text-[10px]">↵</kbd>
            {' '}select
          </span>
          <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">
            {flatItems.length} workflow{flatItems.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
