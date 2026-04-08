import type { WorkflowOrchestrationMode } from '@shared/domain/workflow';

export interface ModeAccent {
  dot: string;
  bar: string;
  label: string;
  color: string;
}

export const modeAccent: Record<WorkflowOrchestrationMode, ModeAccent> = {
  single:       { dot: 'bg-[#245CF9]',                       bar: 'bg-[#245CF9] opacity-60',                       label: 'text-[#245CF9]',                       color: '#245CF9' },
  sequential:   { dot: 'bg-[var(--color-status-warning)]',   bar: 'bg-[var(--color-status-warning)] opacity-60',   label: 'text-[var(--color-status-warning)]',   color: 'var(--color-status-warning)' },
  concurrent:   { dot: 'bg-[var(--color-status-success)]',   bar: 'bg-[var(--color-status-success)] opacity-60',   label: 'text-[var(--color-status-success)]',   color: 'var(--color-status-success)' },
  handoff:      { dot: 'bg-[var(--color-accent-sky)]',       bar: 'bg-[var(--color-accent-sky)] opacity-60',       label: 'text-[var(--color-accent-sky)]',       color: 'var(--color-accent-sky)' },
  'group-chat': { dot: 'bg-[var(--color-accent-purple)]',   bar: 'bg-[var(--color-accent-purple)] opacity-60',   label: 'text-[var(--color-accent-purple)]',   color: 'var(--color-accent-purple)' },
};

export const modeLabels: Record<WorkflowOrchestrationMode, string> = {
  single: 'Single agent',
  sequential: 'Sequential',
  concurrent: 'Concurrent',
  handoff: 'Handoff',
  'group-chat': 'Group chat',
};

export function formatModel(model: string): string {
  return model.replace(/-/g, '\u2011');
}

export function formatEffort(effort: string | undefined): string | undefined {
  if (!effort) return undefined;
  const labels: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Max' };
  return labels[effort] ?? effort;
}
