import type { ElectronApi } from '@shared/contracts/ipc';

declare global {
  interface Window {
    eryxApi: ElectronApi;
  }
}

export {};
