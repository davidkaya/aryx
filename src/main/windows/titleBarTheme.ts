import { nativeTheme, type BrowserWindow } from 'electron';

import type { AppearanceTheme } from '@shared/domain/tooling';

interface TitleBarColors {
  backgroundColor: string;
  overlay: { color: string; symbolColor: string };
}

const darkColors: TitleBarColors = {
  backgroundColor: '#09090b',
  overlay: { color: '#09090b', symbolColor: '#a1a1aa' },
};

const lightColors: TitleBarColors = {
  backgroundColor: '#ffffff',
  overlay: { color: '#ffffff', symbolColor: '#52525b' },
};

function resolveEffectiveTheme(theme: AppearanceTheme): 'dark' | 'light' {
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'dark';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function colorsForTheme(theme: AppearanceTheme): TitleBarColors {
  return resolveEffectiveTheme(theme) === 'light' ? lightColors : darkColors;
}

export function applyTitleBarTheme(window: BrowserWindow, theme: AppearanceTheme): void {
  const { backgroundColor, overlay } = colorsForTheme(theme);
  window.setBackgroundColor(backgroundColor);

  // setTitleBarOverlay is only available on Windows (and some Linux WMs).
  if (typeof window.setTitleBarOverlay === 'function') {
    window.setTitleBarOverlay(overlay);
  }
}
