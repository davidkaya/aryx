const isMac = navigator.platform.startsWith('Mac');

/** Platform-aware modifier key label. */
export const MOD = isMac ? '⌘' : 'Ctrl';

export interface ShortcutDefinition {
  id: string;
  /** Human-readable label for the shortcut cheat sheet. */
  label: string;
  /** Display string for the keybinding. */
  keys: string;
  /** Grouping category. */
  category: 'Navigation' | 'Sessions' | 'Workspace' | 'General';
}

/** Canonical shortcut registry used for the cheat sheet and command palette badges. */
export const shortcuts: ShortcutDefinition[] = [
  // ── Navigation ──
  { id: 'command-palette',  label: 'Command palette',      keys: `${MOD}+K`,           category: 'Navigation' },
  { id: 'settings',         label: 'Open settings',        keys: `${MOD}+,`,           category: 'Navigation' },
  { id: 'toggle-terminal',  label: 'Toggle terminal',      keys: 'Ctrl+`',             category: 'Navigation' },
  { id: 'shortcut-help',    label: 'Keyboard shortcuts',   keys: `${MOD}+/`,           category: 'Navigation' },

  // ── Sessions ──
  { id: 'new-session',      label: 'New session',          keys: `${MOD}+N`,           category: 'Sessions' },
  { id: 'close-session',    label: 'Close / archive',      keys: `${MOD}+W`,           category: 'Sessions' },
  { id: 'next-session',     label: 'Next session',         keys: 'Ctrl+Tab',           category: 'Sessions' },
  { id: 'prev-session',     label: 'Previous session',     keys: 'Ctrl+Shift+Tab',     category: 'Sessions' },

  // ── Workspace ──
  { id: 'quick-approve',    label: 'Quick approve',        keys: `${MOD}+.`,           category: 'Workspace' },
  { id: 'cancel-turn',      label: 'Cancel running turn',  keys: 'Escape',             category: 'Workspace' },
  { id: 'focus-composer',   label: 'Focus composer',       keys: `${MOD}+L`,           category: 'Workspace' },

  // ── General ──
  { id: 'close-overlay',    label: 'Close overlay',        keys: 'Escape',             category: 'General' },
];

/**
 * Look up the display-string for a shortcut by its id.
 * Returns `undefined` if not found.
 */
export function shortcutKeys(id: string): string | undefined {
  return shortcuts.find((s) => s.id === id)?.keys;
}
