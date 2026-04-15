import { useCallback, useEffect, useRef, useState } from 'react';

import { isMac } from '@renderer/lib/platform';

/** Modifier keys we recognise, in canonical display order. */
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

/** Keys that should never be accepted as the primary (non-modifier) key. */
const IGNORED_KEYS = new Set([
  'Dead', 'Unidentified', 'Process', 'CapsLock', 'NumLock', 'ScrollLock',
  'Fn', 'FnLock', 'Hyper', 'Super', 'OS',
]);

/**
 * Convert a portable hotkey string (e.g. `"Alt+Shift+C"`) into
 * platform-aware display tokens.
 */
export function hotkeyToDisplayTokens(hotkey: string): string[] {
  return hotkey
    .replace(/\bSuper\b/g, isMac ? '⌘' : 'Win')
    .replace(/\bMeta\b/g, isMac ? '⌘' : 'Win')
    .replace(/\bCtrl\b/g, isMac ? '⌃' : 'Ctrl')
    .replace(/\bControl\b/g, isMac ? '⌃' : 'Ctrl')
    .replace(/\bAlt\b/g, isMac ? '⌥' : 'Alt')
    .replace(/\bShift\b/g, isMac ? '⇧' : 'Shift')
    .split('+')
    .map((k) => k.trim());
}

/**
 * Normalise a `KeyboardEvent` key name into the portable format used in
 * settings (Electron accelerator-compatible).
 */
function normaliseKeyName(key: string): string | undefined {
  if (MODIFIER_KEYS.has(key) || IGNORED_KEYS.has(key)) return undefined;

  // Letters → uppercase
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();

  // Digits
  if (/^[0-9]$/.test(key)) return key;

  // F-keys
  if (/^F\d{1,2}$/.test(key)) return key;

  // Named keys
  const named: Record<string, string> = {
    ' ': 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Escape',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    '+': 'Plus', '-': 'Minus', '=': 'Equal',
    '[': 'BracketLeft', ']': 'BracketRight',
    '\\': 'Backslash', '/': 'Slash',
    ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period',
    '`': 'Backquote',
  };
  return named[key] ?? key;
}

/** Build the portable hotkey string from modifier flags and a key name. */
function buildHotkeyString(mods: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }, key: string): string {
  const parts: string[] = [];
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.alt) parts.push('Alt');
  if (mods.shift) parts.push('Shift');
  if (mods.meta) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

interface HotkeyRecorderProps {
  value: string;
  onChange: (hotkey: string) => void;
  disabled?: boolean;
}

export function HotkeyRecorder({ value, onChange, disabled }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [liveKeys, setLiveKeys] = useState<string | null>(null);
  const recorderRef = useRef<HTMLButtonElement>(null);

  const displayTokens = hotkeyToDisplayTokens(liveKeys ?? value);

  const stopRecording = useCallback(() => {
    setRecording(false);
    setLiveKeys(null);
  }, []);

  // Escape cancels recording
  // Valid combo (modifier + key) commits immediately
  useEffect(() => {
    if (!recording) return;

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels
      if (e.key === 'Escape') {
        stopRecording();
        return;
      }

      const mods = { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
      const hasModifier = mods.ctrl || mods.alt || mods.shift || mods.meta;
      const key = normaliseKeyName(e.key);

      if (key && hasModifier) {
        const hotkey = buildHotkeyString(mods, key);
        onChange(hotkey);
        setRecording(false);
        setLiveKeys(null);
      } else if (!key) {
        // Only modifiers held — show live preview
        const preview = buildModifierPreview(mods);
        if (preview) setLiveKeys(preview);
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
    }

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [recording, onChange, stopRecording]);

  // Click outside cancels recording
  useEffect(() => {
    if (!recording) return;
    function handleClick(e: MouseEvent) {
      if (recorderRef.current && !recorderRef.current.contains(e.target as Node)) {
        stopRecording();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [recording, stopRecording]);

  return (
    <button
      ref={recorderRef}
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          setRecording(true);
          setLiveKeys(null);
        }
      }}
      aria-label={recording ? 'Press a key combination to set shortcut' : `Change shortcut, currently ${value}`}
      className={`
        group relative flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left
        transition-all duration-200 outline-none
        ${recording
          ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/[0.06] ring-1 ring-[var(--color-accent)]/20'
          : disabled
            ? 'cursor-not-allowed border-[var(--color-border)] opacity-50'
            : 'border-[var(--color-border)] hover:border-[var(--color-border-glow)] hover:bg-[var(--color-surface-3)]/30 cursor-pointer'
        }
      `}
    >
      {/* Key display */}
      <div className="flex flex-1 items-center gap-1.5">
        {recording && !liveKeys ? (
          <span className="flex items-center gap-2 text-[12px] text-[var(--color-text-accent)]">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--color-accent)] opacity-40" />
              <span className="relative inline-flex size-2 rounded-full bg-[var(--color-accent)]" />
            </span>
            Press a key combo…
          </span>
        ) : (
          displayTokens.map((key, i) => (
            <kbd
              key={`${key}-${i}`}
              className={`
                rounded-[5px] border px-2 py-[3px] font-mono text-[11px] font-medium leading-none shadow-sm
                transition-all duration-200
                ${recording
                  ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-text-accent)] shadow-[var(--color-accent)]/10'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] shadow-black/20'
                }
              `}
            >
              {key}
            </kbd>
          ))
        )}
      </div>

      {/* Action hint */}
      <span
        className={`
          shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold tracking-wide uppercase
          transition-all duration-200
          ${recording
            ? 'bg-[var(--color-accent)]/15 text-[var(--color-text-accent)]'
            : 'text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
          }
        `}
      >
        {recording ? 'Esc to cancel' : 'Click to change'}
      </span>
    </button>
  );
}

function buildModifierPreview(mods: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }): string | null {
  const parts: string[] = [];
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.alt) parts.push('Alt');
  if (mods.shift) parts.push('Shift');
  if (mods.meta) parts.push('Super');
  return parts.length > 0 ? parts.join('+') + '+…' : null;
}
