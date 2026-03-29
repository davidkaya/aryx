import { useEffect } from 'react';
import { Keyboard } from 'lucide-react';

import { shortcuts, type ShortcutDefinition } from '@renderer/lib/keyboardShortcuts';

interface KeyboardShortcutsPanelProps {
  onClose: () => void;
}

const categoryOrder = ['Navigation', 'Sessions', 'Workspace', 'General'] as const;

function groupByCategory(defs: ShortcutDefinition[]): Map<string, ShortcutDefinition[]> {
  const groups = new Map<string, ShortcutDefinition[]>();
  for (const def of defs) {
    const list = groups.get(def.category) ?? [];
    list.push(def);
    groups.set(def.category, list);
  }
  return groups;
}

export function KeyboardShortcutsPanel({ onClose }: KeyboardShortcutsPanelProps) {
  // Escape to close — capture phase so it doesn't propagate
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [onClose]);

  const grouped = groupByCategory(shortcuts);

  return (
    <div
      className="palette-backdrop-enter fixed inset-0 z-[70] flex items-center justify-center bg-[#07080e]/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div
        className="palette-enter w-full max-w-lg overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
          <Keyboard className="size-4 text-[var(--color-text-accent)]" />
          <h2
            id="shortcuts-title"
            className="font-display text-[14px] font-semibold text-[var(--color-text-primary)]"
          >
            Keyboard Shortcuts
          </h2>
          <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">
            Press <Kbd>Esc</Kbd> to close
          </span>
        </div>

        {/* Body — two-column grid of categories */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-4">
          {categoryOrder.map((cat) => {
            const items = grouped.get(cat);
            if (!items?.length) return null;
            return (
              <div key={cat}>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  {cat}
                </h3>
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 text-[12.5px]"
                    >
                      <span className="truncate text-[var(--color-text-secondary)]">
                        {item.label}
                      </span>
                      <ShortcutBadge keys={item.keys} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--color-border)] px-5 py-2.5 text-[11px] text-[var(--color-text-muted)]">
          Tip: Use the command palette for even more actions
        </div>
      </div>
    </div>
  );
}

/** Inline keyboard key cap. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-0)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
      {children}
    </kbd>
  );
}

/** Renders a compound shortcut like "Ctrl+Shift+Tab" as joined key caps. */
function ShortcutBadge({ keys }: { keys: string }) {
  const parts = keys.split('+');
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {parts.map((part, i) => (
        <Kbd key={i}>{part}</Kbd>
      ))}
    </span>
  );
}
