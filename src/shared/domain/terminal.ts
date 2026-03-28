export interface TerminalSnapshot {
  cwd: string;
  shell: string;
  pid: number;
  cols: number;
  rows: number;
}

export interface TerminalExitInfo {
  exitCode: number;
  signal?: number;
}
