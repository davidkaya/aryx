export function getElectronApi() {
  if (!window.kopayaApi) {
    throw new Error('The Electron preload API is unavailable.');
  }

  return window.kopayaApi;
}
