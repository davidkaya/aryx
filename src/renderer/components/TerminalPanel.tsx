import { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, Minus, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { getElectronApi } from '@renderer/lib/electronApi';
import type { TerminalSnapshot } from '@shared/domain/terminal';
import type { TerminalExitInfo } from '@shared/domain/terminal';

/* ── Theme ────────────────────────────────────────────────── */

const terminalTheme = {
  background: '#07080e',
  foreground: '#e8eaf0',
  cursor: '#245CF9',
  cursorAccent: '#07080e',
  selectionBackground: 'rgba(36, 92, 249, 0.2)',
  selectionForeground: '#e8eaf0',
  black: '#1e2233',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#248CFD',
  magenta: '#a855f7',
  cyan: '#22d3ee',
  white: '#e8eaf0',
  brightBlack: '#4e5368',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#67e8f9',
  brightWhite: '#f8f9fc',
};

/* ── Constants ────────────────────────────────────────────── */

const MIN_HEIGHT = 120;
const MAX_HEIGHT_FRACTION = 0.7;
const DEFAULT_HEIGHT = 280;

/* ── TerminalPanel ────────────────────────────────────────── */

interface TerminalPanelProps {
  height: number;
  onHeightChange: (height: number) => void;
  onClose: () => void;
  onMinimize: () => void;
}

export function TerminalPanel({
  height,
  onHeightChange,
  onClose,
  onMinimize,
}: TerminalPanelProps) {
  const api = getElectronApi();
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [snapshot, setSnapshot] = useState<TerminalSnapshot>();
  const [isRunning, setIsRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ y: number; height: number } | null>(null);

  // Create or recover terminal on mount
  useEffect(() => {
    let disposed = false;

    void api.describeTerminal().then((existing) => {
      if (disposed) return;
      if (existing) {
        setSnapshot(existing);
        setIsRunning(true);
      } else {
        void api.createTerminal().then((created) => {
          if (disposed) return;
          setSnapshot(created);
          setIsRunning(true);
        });
      }
    });

    return () => {
      disposed = true;
    };
  }, [api]);

  // Initialize xterm.js
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      theme: terminalTheme,
      fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Send keystrokes to the backend
    const dataDisposable = terminal.onData((data) => {
      api.writeTerminal(data);
    });

    // Initial fit
    requestAnimationFrame(() => {
      fitAddon.fit();
      api.resizeTerminal({ cols: terminal.cols, rows: terminal.rows });
    });

    return () => {
      dataDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [api]);

  // Subscribe to terminal data and exit events
  useEffect(() => {
    const offData = api.onTerminalData((data) => {
      terminalRef.current?.write(data);
    });
    const offExit = api.onTerminalExit((_info: TerminalExitInfo) => {
      setIsRunning(false);
      terminalRef.current?.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
    });

    return () => {
      offData();
      offExit();
    };
  }, [api]);

  // Refit on height changes
  useEffect(() => {
    if (!fitAddonRef.current || !terminalRef.current) return;
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
      const terminal = terminalRef.current;
      if (terminal) {
        api.resizeTerminal({ cols: terminal.cols, rows: terminal.rows });
      }
    });
  }, [height, api]);

  // ResizeObserver for container width changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        const terminal = terminalRef.current;
        if (terminal) {
          api.resizeTerminal({ cols: terminal.cols, rows: terminal.rows });
        }
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [api]);

  // Drag-to-resize
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

  const handleRestart = useCallback(() => {
    void api.restartTerminal().then((restarted) => {
      setSnapshot(restarted);
      setIsRunning(true);
      terminalRef.current?.clear();
    });
  }, [api]);

  const handleClose = useCallback(() => {
    void api.killTerminal();
    onClose();
  }, [api, onClose]);

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
        aria-label="Resize terminal"
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

      {/* Header bar */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <span className={`size-1.5 shrink-0 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-[var(--color-text-muted)]'}`} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-muted)]">
          {snapshot ? `${snapshot.shell} — ${snapshot.cwd}` : 'Terminal'}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            aria-label="Restart terminal"
            className="rounded p-0.5 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
            onClick={handleRestart}
            type="button"
          >
            <RotateCcw className="size-3" />
          </button>
          <button
            aria-label="Minimize terminal"
            className="rounded p-0.5 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
            onClick={onMinimize}
            type="button"
          >
            <Minus className="size-3" />
          </button>
          <button
            aria-label="Close terminal"
            className="rounded p-0.5 text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-red-400"
            onClick={handleClose}
            type="button"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div
        className="min-h-0 flex-1 px-1 py-0.5"
        ref={containerRef}
        role="application"
        aria-label="Terminal"
      />
    </div>
  );
}

export { DEFAULT_HEIGHT, MIN_HEIGHT };
