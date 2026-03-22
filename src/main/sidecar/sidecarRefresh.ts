export function shouldRestartSidecarOnCapabilityRefresh(hasActiveRunTurn: boolean): boolean {
  return !hasActiveRunTurn;
}

export function shouldHandleSidecarExit(
  activeProcessId: number | undefined,
  exitingProcessId: number | undefined,
): boolean {
  return activeProcessId !== undefined && exitingProcessId !== undefined && activeProcessId === exitingProcessId;
}
