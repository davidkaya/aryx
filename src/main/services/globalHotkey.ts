import electron from 'electron';

import type { QuickPromptSettings } from '@shared/domain/tooling';

const { globalShortcut } = electron;

export class GlobalHotkeyService {
  private currentAccelerator: string | undefined;
  private callback: (() => void) | undefined;

  register(settings: QuickPromptSettings, callback: () => void): void {
    this.callback = callback;

    if (!settings.enabled) {
      this.unregister();
      return;
    }

    const accelerator = toElectronAccelerator(settings.hotkey);
    if (accelerator === this.currentAccelerator) return;

    this.unregister();
    const registered = globalShortcut.register(accelerator, callback);

    if (registered) {
      this.currentAccelerator = accelerator;
    } else {
      console.warn(`[globalHotkey] Failed to register accelerator: ${accelerator}`);
      this.currentAccelerator = undefined;
    }
  }

  /** Re-registers with updated settings (e.g. hotkey string changed). */
  update(settings: QuickPromptSettings): void {
    if (!this.callback) return;
    this.register(settings, this.callback);
  }

  unregister(): void {
    if (this.currentAccelerator) {
      globalShortcut.unregister(this.currentAccelerator);
      this.currentAccelerator = undefined;
    }
  }

  dispose(): void {
    this.unregister();
    this.callback = undefined;
  }
}

/**
 * Convert our portable hotkey string (e.g. "Super+Shift+A") to an Electron
 * accelerator string. Electron uses "Super" on all platforms, which maps to
 * Cmd on macOS and Win on Windows/Linux.
 */
function toElectronAccelerator(hotkey: string): string {
  return hotkey;
}
