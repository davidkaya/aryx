import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Copy,
  FolderOpen,
  FolderPlus,
  Keyboard,
  MessageSquare,
  Monitor,
  Moon,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Terminal,
} from 'lucide-react';

import type { AppearanceTheme } from '@shared/domain/tooling';
import { isScratchpadProject } from '@shared/domain/project';
import type { WorkspaceState } from '@shared/domain/workspace';
import { shortcutKeys } from '@renderer/lib/keyboardShortcuts';

interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  keywords?: string;
  shortcut?: string;
  icon: React.ReactNode;
  action: () => void;
}

export interface CommandPaletteProps {
  workspace: WorkspaceState;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onSelectProject: (projectId: string) => void;
  onNewSession: (projectId: string) => void;
  onCreateScratchpad: () => void;
  onOpenSettings: () => void;
  onOpenProjectSettings: (projectId: string) => void;
  onToggleTerminal: () => void;
  onSetTheme: (theme: AppearanceTheme) => void;
  onDuplicateSession: (sessionId: string) => void;
  onPinSession: (sessionId: string, isPinned: boolean) => void;
  onArchiveSession: (sessionId: string, isArchived: boolean) => void;
  onAddProject: () => void;
  onOpenAppDataFolder: () => void;
  onShowShortcuts: () => void;
}

/** Score how well `query` matches `text` (and optional `keywords`). 0 = no match. */
function matchScore(query: string, text: string, keywords?: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  if (t.startsWith(q)) return 4;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return 3;
  if (t.includes(q)) return 2;
  if (keywords?.toLowerCase().includes(q)) return 1.5;

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const combined = `${t} ${keywords?.toLowerCase() ?? ''}`;
    if (tokens.every((tok) => combined.includes(tok))) return 1;
  }
  return 0;
}

const ICON = 'size-4';

export function CommandPalette({
  workspace,
  onClose,
  onSelectSession,
  onSelectProject,
  onNewSession,
  onCreateScratchpad,
  onOpenSettings,
  onOpenProjectSettings,
  onToggleTerminal,
  onSetTheme,
  onDuplicateSession,
  onPinSession,
  onArchiveSession,
  onAddProject,
  onOpenAppDataFolder,
  onShowShortcuts,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Intercept Escape in capture phase so it doesn't leak to other overlays
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

  const selectedSession = useMemo(() => {
    const id = workspace.selectedSessionId;
    return id ? workspace.sessions.find((s) => s.id === id) : undefined;
  }, [workspace.sessions, workspace.selectedSessionId]);

  const selectedProject = useMemo(() => {
    const id = workspace.selectedProjectId;
    return id ? workspace.projects.find((p) => p.id === id) : undefined;
  }, [workspace.projects, workspace.selectedProjectId]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const cmds: PaletteCommand[] = [];

    // ── Sessions ──
    const sessions = workspace.sessions
      .filter((s) => !s.isArchived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    for (const s of sessions) {
      const project = workspace.projects.find((p) => p.id === s.projectId);
      const isCurrent = s.id === workspace.selectedSessionId;
      cmds.push({
        id: `session-${s.id}`,
        label: `${s.title}${isCurrent ? ' (current)' : ''}`,
        category: 'Sessions',
        keywords: `switch ${project?.name ?? ''} ${s.status}`,
        icon: <MessageSquare className={ICON} />,
        action: () => onSelectSession(s.id),
      });
    }

    // ── Actions ──
    const defaultProjectId =
      workspace.selectedProjectId ??
      workspace.projects.find((p) => !isScratchpadProject(p))?.id;

    if (defaultProjectId) {
      cmds.push({
        id: 'new-session',
        label: 'New Session',
        category: 'Actions',
        keywords: 'create start',
        shortcut: shortcutKeys('new-session'),
        icon: <Plus className={ICON} />,
        action: () => onNewSession(defaultProjectId),
      });
    }

    cmds.push({
      id: 'new-scratchpad',
      label: 'Quick Scratchpad',
      category: 'Actions',
      keywords: 'create new scratch quick note',
      icon: <Sparkles className={ICON} />,
      action: onCreateScratchpad,
    });

    // ── Current session ──
    if (selectedSession) {
      cmds.push({
        id: 'duplicate-session',
        label: 'Duplicate Session',
        category: 'Session',
        keywords: 'copy clone',
        icon: <Copy className={ICON} />,
        action: () => onDuplicateSession(selectedSession.id),
      });
      cmds.push({
        id: 'pin-session',
        label: selectedSession.isPinned ? 'Unpin Session' : 'Pin Session',
        category: 'Session',
        keywords: 'pin unpin sticky',
        icon: selectedSession.isPinned ? <PinOff className={ICON} /> : <Pin className={ICON} />,
        action: () => onPinSession(selectedSession.id, !selectedSession.isPinned),
      });
      cmds.push({
        id: 'archive-session',
        label: 'Archive Session',
        category: 'Session',
        keywords: 'archive hide remove close',
        shortcut: shortcutKeys('close-session'),
        icon: <Archive className={ICON} />,
        action: () => onArchiveSession(selectedSession.id, true),
      });
    }

    // ── Projects ──
    const userProjects = workspace.projects.filter((p) => !isScratchpadProject(p));
    for (const p of userProjects) {
      const isCurrent = p.id === workspace.selectedProjectId;
      cmds.push({
        id: `project-${p.id}`,
        label: `${p.name}${isCurrent ? ' (current)' : ''}`,
        category: 'Projects',
        keywords: `switch folder ${p.path}`,
        icon: <FolderOpen className={ICON} />,
        action: () => onSelectProject(p.id),
      });
    }
    cmds.push({
      id: 'add-project',
      label: 'Add Project',
      category: 'Projects',
      keywords: 'folder new open browse',
      icon: <FolderPlus className={ICON} />,
      action: onAddProject,
    });

    // ── General ──
    cmds.push({
      id: 'settings',
      label: 'Open Settings',
      category: 'General',
      keywords: 'preferences config options',
      shortcut: shortcutKeys('settings'),
      icon: <Settings className={ICON} />,
      action: onOpenSettings,
    });

    if (selectedProject && !isScratchpadProject(selectedProject)) {
      cmds.push({
        id: 'project-settings',
        label: `Project Settings — ${selectedProject.name}`,
        category: 'General',
        keywords: 'project config options customization',
        icon: <Settings className={ICON} />,
        action: () => onOpenProjectSettings(selectedProject.id),
      });
    }

    cmds.push({
      id: 'toggle-terminal',
      label: 'Toggle Terminal',
      category: 'General',
      keywords: 'terminal console shell command',
      shortcut: shortcutKeys('toggle-terminal'),
      icon: <Terminal className={ICON} />,
      action: onToggleTerminal,
    });

    cmds.push({
      id: 'app-data',
      label: 'Open App Data Folder',
      category: 'General',
      keywords: 'data storage files folder workspace',
      icon: <FolderOpen className={ICON} />,
      action: onOpenAppDataFolder,
    });

    cmds.push({
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      category: 'General',
      keywords: 'keys keybindings hotkeys help cheatsheet',
      shortcut: shortcutKeys('shortcut-help'),
      icon: <Keyboard className={ICON} />,
      action: onShowShortcuts,
    });

    // ── Theme ──
    cmds.push({
      id: 'theme-dark',
      label: 'Dark Theme',
      category: 'Theme',
      keywords: 'appearance dark mode night',
      icon: <Moon className={ICON} />,
      action: () => onSetTheme('dark'),
    });
    cmds.push({
      id: 'theme-light',
      label: 'Light Theme',
      category: 'Theme',
      keywords: 'appearance light mode day',
      icon: <Sun className={ICON} />,
      action: () => onSetTheme('light'),
    });
    cmds.push({
      id: 'theme-system',
      label: 'System Theme',
      category: 'Theme',
      keywords: 'appearance auto system follow',
      icon: <Monitor className={ICON} />,
      action: () => onSetTheme('system'),
    });

    return cmds;
  }, [
    workspace, selectedSession, selectedProject,
    onSelectSession, onSelectProject, onNewSession, onCreateScratchpad,
    onOpenSettings, onOpenProjectSettings, onToggleTerminal, onSetTheme,
    onDuplicateSession, onPinSession, onArchiveSession, onAddProject,
    onOpenAppDataFolder, onShowShortcuts,
  ]);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((cmd) => ({ cmd, score: matchScore(query, cmd.label, cmd.keywords) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ cmd }) => cmd);
  }, [commands, query]);

  const groupedCommands = useMemo(() => {
    const groups: { category: string; commands: PaletteCommand[] }[] = [];
    const seen = new Set<string>();
    for (const cmd of filteredCommands) {
      if (!seen.has(cmd.category)) {
        seen.add(cmd.category);
        groups.push({ category: cmd.category, commands: [] });
      }
      groups.find((g) => g.category === cmd.category)!.commands.push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const executeCommand = useCallback(
    (cmd: PaletteCommand) => {
      onClose();
      cmd.action();
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredCommands.length > 0) {
          setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[selectedIndex];
        if (cmd) executeCommand(cmd);
      }
    },
    [filteredCommands, selectedIndex, executeCommand],
  );

  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-palette-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  let flatIndex = 0;

  return (
    <div
      className="palette-backdrop-enter fixed inset-0 z-[60] flex justify-center bg-[#07080e]/80 pt-[18vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="palette-enter glow-border flex h-fit max-h-[min(420px,60vh)] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-[var(--color-surface-1)] shadow-[0_16px_64px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
          <Search className="size-4 shrink-0 text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent py-3.5 text-[14px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            placeholder="Type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)] transition hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
              onClick={() => setQuery('')}
              type="button"
            >
              Clear
            </button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5" role="listbox">
          {groupedCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-[var(--color-text-muted)]">
              No matching commands
            </div>
          ) : (
            groupedCommands.map((group) => (
              <div key={group.category}>
                <div className="px-4 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  {group.category}
                </div>
                {group.commands.map((cmd) => {
                  const index = flatIndex++;
                  const isSelected = index === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      data-palette-index={index}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors ${
                        isSelected
                          ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-glass-hover)] hover:text-[var(--color-text-primary)]'
                      }`}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      role="option"
                      aria-selected={isSelected}
                      type="button"
                    >
                      <span
                        className={
                          isSelected
                            ? 'text-[var(--color-text-accent)]'
                            : 'text-[var(--color-text-muted)]'
                        }
                      >
                        {cmd.icon}
                      </span>
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-0)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border-subtle)] px-1 font-mono text-[10px]">
              ↑↓
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border-subtle)] px-1 font-mono text-[10px]">
              ↵
            </kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border-subtle)] px-1 font-mono text-[10px]">
              esc
            </kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
