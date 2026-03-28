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
  background: '#09090b',   // zinc-950
  foreground: '#e4e4e7',   // zinc-200
  cursor: '#818cf8',       // indigo-400
  cursorAccent: '#09090b',
  selectionBackground: '#6366f14d', // indigo-500/30
  selectionForeground: '#e4e4e7',
  black: '#27272a',        // zinc-800
  red: '#f87171',          // red-400
  green: '#4ade80',        // green-400
  yellow: '#facc15',       // yellow-400
  blue: '#60a5fa',         // blue-400
  magenta: '#c084fc',      // purple-400
  cyan: '#22d3ee',         // cyan-400
  white: '#e4e4e7',        // zinc-200
  brightBlack: '#52525b',  // zinc-600
  brightRed: '#fca5a5',    // red-300
  brightGreen: '#86efac',  // green-300
  brightYellow: '#fde047', // yellow-300
  brightBlue: '#93c5fd',   // blue-300
  brightMagenta: '#d8b4fe',// purple-300
  brightCyan: '#67e8f9',   // cyan-300
  brightWhite: '#fafafa',  // zinc-50
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
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
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
      className="flex flex-col border-t border-[var(--color-border)] bg-[#09090b]"
      style={{ height, minHeight: MIN_HEIGHT }}
    >
      {/* Resize handle */}
      <div
        className={`h-1 shrink-0 cursor-row-resize transition-colors ${isDragging ? 'bg-indigo-500/40' : 'hover:bg-zinc-700/60'}`}
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
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-zinc-800/60 px-3">
        <span className={`size-1.5 shrink-0 rounded-full ${isRunning ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
          {snapshot ? `${snapshot.shell} — ${snapshot.cwd}` : 'Terminal'}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            aria-label="Restart terminal"
            className="rounded p-0.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-400"
            onClick={handleRestart}
            type="button"
          >
            <RotateCcw className="size-3" />
          </button>
          <button
            aria-label="Minimize terminal"
            className="rounded p-0.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-zinc-400"
            onClick={onMinimize}
            type="button"
          >
            <Minus className="size-3" />
          </button>
          <button
            aria-label="Close terminal"
            className="rounded p-0.5 text-zinc-600 transition hover:bg-zinc-800 hover:text-red-400"
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
