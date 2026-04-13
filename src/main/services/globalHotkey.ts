import electron from 'electron';

import type { QuickPromptSettings } from '@shared/domain/tooling';

export class GlobalHotkeyService {
  private currentAccelerator: string | undefined;
  private lastFailedAccelerator: string | undefined;
  private callback: (() => void) | undefined;

  register(settings: QuickPromptSettings, callback: () => void): void {
    this.callback = callback;

    if (!settings.enabled) {
      this.unregister();
      return;
    }

    const accelerator = toElectronAccelerator(settings.hotkey);

    // Already registered this accelerator — nothing to do
    if (accelerator === this.currentAccelerator) return;

    // Don't retry an accelerator that already failed (avoids log spam on
    // repeated workspace-updated events during startup)
    if (accelerator === this.lastFailedAccelerator) return;

    this.unregister();

    // Access globalShortcut lazily to ensure electron is fully initialised
    const { globalShortcut } = electron;
    if (!globalShortcut) {
      console.error('[globalHotkey] electron.globalShortcut is not available');
      return;
    }

    try {
      const registered = globalShortcut.register(accelerator, callback);
      if (registered) {
        console.info(`[globalHotkey] Registered: ${accelerator}`);
        this.currentAccelerator = accelerator;
        this.lastFailedAccelerator = undefined;
      } else {
        console.warn(
          `[globalHotkey] Failed to register accelerator: ${accelerator}` +
            ' — it may be reserved by the OS or another application',
        );
        this.currentAccelerator = undefined;
        this.lastFailedAccelerator = accelerator;
      }
    } catch (err) {
      console.error(`[globalHotkey] Error registering ${accelerator}:`, err);
      this.currentAccelerator = undefined;
      this.lastFailedAccelerator = accelerator;
    }
  }

  /** Re-registers with updated settings (e.g. hotkey string changed). */
  update(settings: QuickPromptSettings): void {
    if (!this.callback) return;
    this.register(settings, this.callback);
  }

  unregister(): void {
    if (this.currentAccelerator) {
      try {
        const { globalShortcut } = electron;
        globalShortcut?.unregister(this.currentAccelerator);
      } catch {
        // best-effort
      }
      this.currentAccelerator = undefined;
    }
    this.lastFailedAccelerator = undefined;
  }

  dispose(): void {
    this.unregister();
    this.callback = undefined;
  }
}

/**
 * Convert a portable hotkey string to an Electron accelerator.
 *
 * - "Super" → "Meta" (Win key on Windows, Cmd on macOS)
 * - Strings already using Electron-native names pass through unchanged.
 */
function toElectronAccelerator(hotkey: string): string {
  return hotkey.replace(/\bSuper\b/gi, 'Meta');
}
