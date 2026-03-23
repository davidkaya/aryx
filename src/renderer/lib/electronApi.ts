export function getElectronApi() {
  if (!window.eryxApi) {
    throw new Error('The Electron preload API is unavailable.');
  }

  return window.eryxApi;
}
