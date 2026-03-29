import electron from 'electron';
import type { BrowserWindow } from 'electron';

import type { SessionEventRecord } from '@shared/domain/event';
import type { WorkspaceState } from '@shared/domain/workspace';

const { Notification } = electron;

/**
 * Creates a handler that shows native OS notifications for session run
 * completions, failures, and approval requests when the window is unfocused.
 *
 * Clicking a notification focuses the window and selects the relevant session.
 */
export function createDesktopNotificationHandler(
  getWindow: () => BrowserWindow | undefined,
  getWorkspace: () => WorkspaceState | undefined,
  selectSession: (sessionId: string) => Promise<WorkspaceState>,
): (event: SessionEventRecord) => void {
  const runningSessions = new Set<string>();
  const notifiedApprovals = new Set<string>();

  return (event: SessionEventRecord) => {
    const window = getWindow();
    if (window?.isFocused()) return;

    const workspace = getWorkspace();
    if (workspace?.settings.notificationsEnabled === false) return;

    if (!Notification.isSupported()) return;

    const session = workspace?.sessions.find((s) => s.id === event.sessionId);
    const sessionTitle = session?.title ?? 'Session';

    // Track running sessions to detect completion/failure transitions
    if (event.kind === 'status') {
      if (event.status === 'running') {
        runningSessions.add(event.sessionId);
        return;
      }

      if (!runningSessions.has(event.sessionId)) return;
      runningSessions.delete(event.sessionId);

      if (event.status === 'idle') {
        showNotification('Run completed', sessionTitle, event.sessionId, window, selectSession);
      } else if (event.status === 'error') {
        showNotification('Run failed', sessionTitle, event.sessionId, window, selectSession);
      }
      return;
    }

    // Detect new approval requests from run-updated events
    if (event.kind === 'run-updated' && event.run) {
      const approvalEvent = [...event.run.events]
        .reverse()
        .find((e) => e.kind === 'approval' && e.status === 'running');

      if (approvalEvent?.approvalId && !notifiedApprovals.has(approvalEvent.approvalId)) {
        notifiedApprovals.add(approvalEvent.approvalId);
        const body = approvalEvent.approvalTitle
          ? `${sessionTitle}: ${approvalEvent.approvalTitle}`
          : sessionTitle;
        showNotification('Approval needed', body, event.sessionId, window, selectSession);
      }
    }
  };
}

function showNotification(
  title: string,
  body: string,
  sessionId: string,
  window: BrowserWindow | undefined,
  selectSession: (sessionId: string) => Promise<WorkspaceState>,
): void {
  const notification = new Notification({ title, body, silent: false });

  notification.on('click', () => {
    window?.show();
    window?.focus();
    void selectSession(sessionId);
  });

  notification.show();
}
