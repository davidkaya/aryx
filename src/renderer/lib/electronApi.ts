export function getElectronApi() {
  if (!window.aryxApi) {
    throw new Error('The Electron preload API is unavailable.');
  }

  return window.aryxApi;
}
