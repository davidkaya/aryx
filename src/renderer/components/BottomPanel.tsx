import { useCallback, useRef, useState, type ReactNode } from 'react';
import { GitBranch, Minus, TerminalSquare, X } from 'lucide-react';

/* ── Constants ────────────────────────────────────────────── */

const MIN_HEIGHT = 120;
const MAX_HEIGHT_FRACTION = 0.7;
const DEFAULT_HEIGHT = 280;

/* ── Types ────────────────────────────────────────────────── */

export type BottomPanelTab = 'terminal' | 'git';

/* ── BottomPanel ──────────────────────────────────────────── */

interface BottomPanelProps {
  activeTab: BottomPanelTab;
  onTabChange: (tab: BottomPanelTab) => void;
  onClose: () => void;
  height: number;
  onHeightChange: (height: number) => void;
  terminalContent: ReactNode;
  gitContent: ReactNode;
  showGitTab: boolean;
  terminalRunning?: boolean;
  gitDirty?: boolean;
}

export function BottomPanel({
  activeTab,
  onTabChange,
  onClose,
  height,
  onHeightChange,
  terminalContent,
  gitContent,
  showGitTab,
  terminalRunning,
  gitDirty,
}: BottomPanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, height };
    setIsDragging(true);

    const handleDragMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const maxHeight = window.innerHeight * MAX_HEIGHT_FRACTION;
      const delta = dragStartRef.current.y - moveEvent.clientY;
      const nextHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, dragStartRef.current.height + delta));
      onHeightChange(nextHeight);
    };

    const handleDragEnd = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }, [height, onHeightChange]);

  return (
    <div
      className="flex flex-col border-t border-[var(--color-border)] bg-[var(--color-surface-0)]"
      style={{ height, minHeight: MIN_HEIGHT }}
    >
      {/* Resize handle */}
      <div
        className={`h-1 shrink-0 cursor-row-resize transition-colors ${isDragging ? 'bg-[var(--color-accent)]/40' : 'hover:bg-[var(--color-surface-3)]/60'}`}
        onMouseDown={handleDragStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize panel"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            onHeightChange(Math.min(window.innerHeight * MAX_HEIGHT_FRACTION, height + 20));
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onHeightChange(Math.max(MIN_HEIGHT, height - 20));
          }
        }}
      />

      {/* Tab bar */}
      <div className="flex h-8 shrink-0 items-center border-b border-[var(--color-border)] px-1">
        {/* Terminal tab */}
        <button
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors duration-100 ${
            activeTab === 'terminal'
              ? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]/50 hover:text-[var(--color-text-secondary)]'
          }`}
          onClick={() => onTabChange('terminal')}
          type="button"
          role="tab"
          aria-selected={activeTab === 'terminal'}
        >
          {terminalRunning && <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />}
          <TerminalSquare className="size-3" />
          Terminal
        </button>

        {/* Git tab */}
        {showGitTab && (
          <button
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors duration-100 ${
              activeTab === 'git'
                ? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]/50 hover:text-[var(--color-text-secondary)]'
            }`}
            onClick={() => onTabChange('git')}
            type="button"
            role="tab"
            aria-selected={activeTab === 'git'}
          >
            {gitDirty && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-status-warning)]" />}
            <GitBranch className="size-3" />
            Git
          </button>
        )}

        <div className="flex-1" />

        {/* Minimize */}
        <button
          aria-label="Minimize panel"
          className="rounded p-1 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
          onClick={onClose}
          type="button"
        >
          <Minus className="size-3" />
        </button>

        {/* Close */}
        <button
          aria-label="Close panel"
          className="rounded p-1 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-red-400"
          onClick={onClose}
          type="button"
        >
          <X className="size-3" />
        </button>
      </div>

      {/* Tab content — both always mounted, only active one visible */}
      <div className="relative min-h-0 flex-1">
        <div className={`absolute inset-0 flex flex-col ${activeTab === 'terminal' ? '' : 'invisible'}`}>
          {terminalContent}
        </div>
        {showGitTab && (
          <div className={`absolute inset-0 flex flex-col overflow-y-auto ${activeTab === 'git' ? '' : 'hidden'}`}>
            {gitContent}
          </div>
        )}
      </div>
    </div>
  );
}

export { DEFAULT_HEIGHT, MIN_HEIGHT };
