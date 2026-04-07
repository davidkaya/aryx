import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

import {
  formatToolCallSummary,
  formatToolArgumentValue,
  getDisplayableArguments,
} from '@renderer/lib/toolCallSummary';

export interface ToolCallDetailPanelProps {
  toolName?: string;
  toolArguments?: Record<string, unknown>;
}

export function ToolCallDetailPanel({ toolName, toolArguments }: ToolCallDetailPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const summary = formatToolCallSummary(toolName, toolArguments);
  const displayArgs = getDisplayableArguments(toolArguments);
  const hasExpandableContent = displayArgs.length > 0;

  if (!summary && !hasExpandableContent) return null;

  return (
    <div className="mt-0.5">
      {/* Inline summary — always visible when summary exists */}
      <button
        type="button"
        className={`group flex max-w-full items-start gap-1 text-left text-[11px] leading-snug ${
          hasExpandableContent
            ? 'cursor-pointer hover:text-[var(--color-text-secondary)]'
            : 'cursor-default'
        }`}
        onClick={hasExpandableContent ? () => setExpanded((prev) => !prev) : undefined}
        aria-expanded={hasExpandableContent ? expanded : undefined}
        aria-label={hasExpandableContent ? `Toggle ${toolName} arguments` : undefined}
        tabIndex={hasExpandableContent ? 0 : -1}
        onKeyDown={hasExpandableContent
          ? (e) => { if (e.key === ' ') { e.preventDefault(); setExpanded((prev) => !prev); } }
          : undefined}
      >
        {hasExpandableContent && (
          <ChevronRight
            className={`mt-px size-2.5 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${
              expanded ? 'rotate-90' : ''
            }`}
          />
        )}
        {summary && (
          <span className="min-w-0 truncate font-mono text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]">
            {summary}
          </span>
        )}
      </button>

      {/* Expanded argument list */}
      {expanded && hasExpandableContent && (
        <div className="mt-1 overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]/80">
          <div className="max-h-48 overflow-auto">
            {displayArgs.map(([key, value]) => {
              const formatted = formatToolArgumentValue(value);
              const isMultiline = formatted.includes('\n') || formatted.length > 120;

              return (
                <div
                  key={key}
                  className="border-b border-[var(--color-border-subtle)] px-2 py-1 last:border-b-0"
                >
                  <span className="text-[10px] font-semibold tracking-wide text-[var(--color-accent-purple)]">
                    {key}
                  </span>
                  {isMultiline ? (
                    <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-[var(--color-text-secondary)]">
                      {formatted}
                    </pre>
                  ) : (
                    <span className="ml-1.5 font-mono text-[10px] text-[var(--color-text-secondary)]">
                      {formatted}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
