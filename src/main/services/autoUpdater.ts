import electronUpdater from 'electron-updater';

import type {
  UpdateDownloadProgress,
  UpdateStatus,
} from '@shared/contracts/ipc';

interface AutoUpdateInfoLike {
  version?: string | null;
  releaseDate?: string | null;
  releaseNotes?: unknown;
}

interface AutoUpdateProgressLike {
  bytesPerSecond: number;
  percent: number;
  total: number;
  transferred: number;
}

type AutoUpdateListener = (...args: any[]) => void;

interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  forceDevUpdateConfig: boolean;
  on(event: string, listener: AutoUpdateListener): this;
  removeListener(event: string, listener: AutoUpdateListener): this;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface AutoUpdateScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface AutoUpdateServiceOptions {
  isPackaged: boolean;
  startupDelayMs?: number;
  recheckIntervalMs?: number;
  updater?: AutoUpdaterLike;
  scheduler?: AutoUpdateScheduler;
}

const DEFAULT_STARTUP_DELAY_MS = 10_000;
const DEFAULT_RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const defaultScheduler: AutoUpdateScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizeOptionalString(value);
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const notes = value
    .map((item) => {
      if (typeof item === 'string') {
        return normalizeOptionalString(item);
      }

      if (!item || typeof item !== 'object') {
        return undefined;
      }

      const record = item as { note?: unknown; version?: unknown };
      const version = typeof record.version === 'string' ? normalizeOptionalString(record.version) : undefined;
      const note = typeof record.note === 'string' ? normalizeOptionalString(record.note) : undefined;
      if (version && note) {
        return `${version}\n${note}`;
      }

      return note ?? version;
    })
    .filter((entry): entry is string => Boolean(entry));

  return notes.length > 0 ? notes.join('\n\n') : undefined;
}

function normalizeProgress(progress: AutoUpdateProgressLike): UpdateDownloadProgress {
  return {
    bytesPerSecond: progress.bytesPerSecond,
    percent: progress.percent,
    total: progress.total,
    transferred: progress.transferred,
  };
}

function createStatusFromInfo(
  state: Extract<UpdateStatus['state'], 'available' | 'downloaded'>,
  info: AutoUpdateInfoLike,
): UpdateStatus {
  return {
    state,
    version: normalizeOptionalString(info.version),
    releaseDate: normalizeOptionalString(info.releaseDate),
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
  };
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown update error.';
}

export class AutoUpdateService {
  private readonly updater: AutoUpdaterLike;

  private readonly scheduler: AutoUpdateScheduler;

  private readonly listeners = new Set<(status: UpdateStatus) => void>();

  private status: UpdateStatus = { state: 'idle' };

  private started = false;

  private initialCheckHandle?: unknown;

  private periodicCheckHandle?: unknown;

  private pendingCheck?: Promise<UpdateStatus>;

  private readonly checkingListener = () => {
    this.publishStatus({ state: 'checking' });
  };

  private readonly availableListener = (info: AutoUpdateInfoLike) => {
    this.publishStatus(createStatusFromInfo('available', info));
  };

  private readonly notAvailableListener = () => {
    this.publishStatus({ state: 'up-to-date' });
  };

  private readonly progressListener = (progress: AutoUpdateProgressLike) => {
    this.publishStatus({
      ...this.status,
      state: 'downloading',
      downloadProgress: normalizeProgress(progress),
    });
  };

  private readonly downloadedListener = (info: AutoUpdateInfoLike) => {
    this.publishStatus(createStatusFromInfo('downloaded', info));
  };

  private readonly errorListener = (error: unknown) => {
    this.publishStatus({
      ...this.status,
      state: 'error',
      error: resolveErrorMessage(error),
    });
  };

  constructor(private readonly options: AutoUpdateServiceOptions) {
    this.updater = options.updater
      ?? (electronUpdater as { autoUpdater: AutoUpdaterLike }).autoUpdater;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.forceDevUpdateConfig = !options.isPackaged;

    this.updater.on('checking-for-update', this.checkingListener);
    this.updater.on('update-available', this.availableListener);
    this.updater.on('update-not-available', this.notAvailableListener);
    this.updater.on('download-progress', this.progressListener);
    this.updater.on('update-downloaded', this.downloadedListener);
    this.updater.on('error', this.errorListener);
  }

  start(): void {
    if (this.started || !this.options.isPackaged) {
      return;
    }

    this.started = true;
    this.initialCheckHandle = this.scheduler.setTimeout(() => {
      void this.checkForUpdates();
    }, this.options.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS);
    this.periodicCheckHandle = this.scheduler.setInterval(() => {
      void this.checkForUpdates();
    }, this.options.recheckIntervalMs ?? DEFAULT_RECHECK_INTERVAL_MS);
  }

  getStatus(): UpdateStatus {
    return this.cloneStatus(this.status);
  }

  onStatus(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    if (this.pendingCheck) {
      return this.pendingCheck;
    }

    const request = this.updater.checkForUpdates()
      .catch((error) => {
        this.errorListener(error);
      })
      .then(() => this.getStatus())
      .finally(() => {
        if (this.pendingCheck === request) {
          this.pendingCheck = undefined;
        }
      });

    this.pendingCheck = request;
    return request;
  }

  installUpdate(): void {
    if (this.status.state !== 'downloaded') {
      return;
    }

    this.updater.quitAndInstall();
  }

  dispose(): void {
    if (this.initialCheckHandle !== undefined) {
      this.scheduler.clearTimeout(this.initialCheckHandle);
      this.initialCheckHandle = undefined;
    }

    if (this.periodicCheckHandle !== undefined) {
      this.scheduler.clearInterval(this.periodicCheckHandle);
      this.periodicCheckHandle = undefined;
    }

    this.updater.removeListener('checking-for-update', this.checkingListener);
    this.updater.removeListener('update-available', this.availableListener);
    this.updater.removeListener('update-not-available', this.notAvailableListener);
    this.updater.removeListener('download-progress', this.progressListener);
    this.updater.removeListener('update-downloaded', this.downloadedListener);
    this.updater.removeListener('error', this.errorListener);
    this.listeners.clear();
  }

  private publishStatus(status: UpdateStatus): void {
    this.status = this.cloneStatus(status);
    for (const listener of this.listeners) {
      listener(this.cloneStatus(this.status));
    }
  }

  private cloneStatus(status: UpdateStatus): UpdateStatus {
    return status.downloadProgress
      ? { ...status, downloadProgress: { ...status.downloadProgress } }
      : { ...status };
  }
}
