export function shouldRestartSidecarOnCapabilityRefresh(hasActiveRunTurn: boolean): boolean {
  return !hasActiveRunTurn;
}
