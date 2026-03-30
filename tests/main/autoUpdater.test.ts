import { EventEmitter } from 'node:events';

import { describe, expect, test } from 'bun:test';

import { AutoUpdateService, type AutoUpdateScheduler } from '@main/services/autoUpdater';
import type { UpdateStatus } from '@shared/contracts/ipc';

class FakeUpdater extends EventEmitter {
  autoDownload = false;

  autoInstallOnAppQuit = true;

  forceDevUpdateConfig = false;

  checkForUpdatesCalls = 0;

  quitAndInstallCalls = 0;

  async checkForUpdates(): Promise<void> {
    this.checkForUpdatesCalls += 1;
  }

  quitAndInstall(): void {
    this.quitAndInstallCalls += 1;
  }
}

class FakeScheduler implements AutoUpdateScheduler {
  readonly timeouts: Array<{ callback: () => void; delayMs: number }> = [];

  readonly intervals: Array<{ callback: () => void; delayMs: number }> = [];

  setTimeout(callback: () => void, delayMs: number): number {
    this.timeouts.push({ callback, delayMs });
    return this.timeouts.length - 1;
  }

  clearTimeout(handle: unknown): void {
    const index = Number(handle);
    if (Number.isInteger(index) && index >= 0) {
      this.timeouts.splice(index, 1);
    }
  }

  setInterval(callback: () => void, delayMs: number): number {
    this.intervals.push({ callback, delayMs });
    return this.intervals.length - 1;
  }

  clearInterval(handle: unknown): void {
    const index = Number(handle);
    if (Number.isInteger(index) && index >= 0) {
      this.intervals.splice(index, 1);
    }
  }

  async runTimeout(index = 0): Promise<void> {
    await Promise.resolve(this.timeouts[index]?.callback());
  }

  async runInterval(index = 0): Promise<void> {
    await Promise.resolve(this.intervals[index]?.callback());
  }
}

describe('AutoUpdateService', () => {
  test('does not schedule checks for unpackaged apps but manual checks still work', async () => {
    const updater = new FakeUpdater();
    const scheduler = new FakeScheduler();
    const service = new AutoUpdateService({ isPackaged: false, scheduler, updater });

    service.start();

    expect(scheduler.timeouts).toHaveLength(0);
    expect(scheduler.intervals).toHaveLength(0);
    expect(updater.forceDevUpdateConfig).toBe(true);

    await service.checkForUpdates();
    expect(updater.checkForUpdatesCalls).toBe(1);
  });

  test('configures auto download and schedules startup and periodic checks', async () => {
    const updater = new FakeUpdater();
    const scheduler = new FakeScheduler();
    const service = new AutoUpdateService({ isPackaged: true, scheduler, updater });

    service.start();

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(scheduler.timeouts).toEqual([{ callback: expect.any(Function), delayMs: 10_000 }]);
    expect(scheduler.intervals).toEqual([{ callback: expect.any(Function), delayMs: 4 * 60 * 60 * 1000 }]);

    await scheduler.runTimeout();
    await Promise.resolve();
    await scheduler.runInterval();
    await Promise.resolve();

    expect(updater.checkForUpdatesCalls).toBe(2);
  });

  test('maps updater events into renderer-facing status snapshots', () => {
    const updater = new FakeUpdater();
    const service = new AutoUpdateService({ isPackaged: true, updater });
    const statuses: UpdateStatus[] = [];
    service.onStatus((status) => statuses.push(status));

    updater.emit('checking-for-update');
    updater.emit('update-available', {
      version: '1.2.0',
      releaseDate: '2026-03-29T00:00:00.000Z',
      releaseNotes: 'Important fixes.',
    });
    updater.emit('download-progress', {
      bytesPerSecond: 512,
      percent: 25,
      total: 400,
      transferred: 100,
    });
    updater.emit('update-downloaded', {
      version: '1.2.0',
      releaseDate: '2026-03-29T00:00:00.000Z',
      releaseNotes: 'Important fixes.',
    });

    expect(statuses).toEqual([
      { state: 'checking' },
      {
        state: 'available',
        version: '1.2.0',
        releaseDate: '2026-03-29T00:00:00.000Z',
        releaseNotes: 'Important fixes.',
      },
      {
        state: 'downloading',
        version: '1.2.0',
        releaseDate: '2026-03-29T00:00:00.000Z',
        releaseNotes: 'Important fixes.',
        downloadProgress: {
          bytesPerSecond: 512,
          percent: 25,
          total: 400,
          transferred: 100,
        },
      },
      {
        state: 'downloaded',
        version: '1.2.0',
        releaseDate: '2026-03-29T00:00:00.000Z',
        releaseNotes: 'Important fixes.',
      },
    ]);
  });

  test('transitions to up-to-date when no update is available', () => {
    const updater = new FakeUpdater();
    const service = new AutoUpdateService({ isPackaged: true, updater });
    const statuses: UpdateStatus[] = [];
    service.onStatus((status) => statuses.push(status));

    updater.emit('checking-for-update');
    updater.emit('update-not-available', {});

    expect(statuses).toEqual([
      { state: 'checking' },
      { state: 'up-to-date' },
    ]);
    expect(service.getStatus()).toEqual({ state: 'up-to-date' });
  });

  test('reports updater errors and only installs once an update is downloaded', () => {
    const updater = new FakeUpdater();
    const service = new AutoUpdateService({ isPackaged: true, updater });

    service.installUpdate();
    expect(updater.quitAndInstallCalls).toBe(0);

    updater.emit('error', new Error('network down'));
    expect(service.getStatus()).toEqual({
      state: 'error',
      error: 'network down',
    });

    updater.emit('update-downloaded', {
      version: '1.2.1',
      releaseDate: '2026-03-29T00:00:00.000Z',
      releaseNotes: 'Patch release.',
    });
    service.installUpdate();

    expect(updater.quitAndInstallCalls).toBe(1);
  });
});
