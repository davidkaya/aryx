import type { ChatMessageRecord } from '@shared/domain/session';
import type { RunTimelineEventRecord } from '@shared/domain/runTimeline';

/* ── Input / output types ──────────────────────────────────── */

/** A flat activity stream item (the existing model). */
export type ActivityStreamItem =
  | { kind: 'thinking-step'; message: ChatMessageRecord }
  | { kind: 'timeline-event'; event: RunTimelineEventRecord };

/** A grouped timeline item ready for rendering. */
export type GroupedActivityItem =
  | { kind: 'intent-divider'; intentText: string; event: RunTimelineEventRecord }
  | { kind: 'single-event'; event: RunTimelineEventRecord }
  | { kind: 'tool-group'; toolName: string; events: RunTimelineEventRecord[] }
  | { kind: 'thinking-group'; messages: ChatMessageRecord[] }
  | { kind: 'single-thinking'; message: ChatMessageRecord };

/* ── Events to skip in the inline panel ────────────────────── */

const SKIP_EVENT_KINDS = new Set(['run-started', 'thinking']);

/* ── Build the flat stream (moved from TurnActivityPanel) ──── */

export function buildActivityStream(
  thinkingMessages: ChatMessageRecord[],
  events: readonly RunTimelineEventRecord[],
): ActivityStreamItem[] {
  const items: ActivityStreamItem[] = [];

  for (const msg of thinkingMessages) {
    items.push({ kind: 'thinking-step', message: msg });
  }

  for (const event of events) {
    if (SKIP_EVENT_KINDS.has(event.kind)) continue;
    items.push({ kind: 'timeline-event', event });
  }

  items.sort((a, b) => {
    const tsA = a.kind === 'thinking-step' ? a.message.createdAt : a.event.occurredAt;
    const tsB = b.kind === 'thinking-step' ? b.message.createdAt : b.event.occurredAt;
    return new Date(tsA).getTime() - new Date(tsB).getTime();
  });

  return items;
}

/* ── Group the flat stream into displayable chunks ─────────── */

export function groupActivityStream(items: ActivityStreamItem[]): GroupedActivityItem[] {
  const result: GroupedActivityItem[] = [];

  let i = 0;
  while (i < items.length) {
    const item = items[i];

    // ── Thinking steps: group consecutive runs ──────────────
    if (item.kind === 'thinking-step') {
      const group: ChatMessageRecord[] = [item.message];
      let j = i + 1;
      while (j < items.length && items[j].kind === 'thinking-step') {
        group.push((items[j] as { kind: 'thinking-step'; message: ChatMessageRecord }).message);
        j++;
      }
      if (group.length === 1) {
        result.push({ kind: 'single-thinking', message: group[0] });
      } else {
        result.push({ kind: 'thinking-group', messages: group });
      }
      i = j;
      continue;
    }

    // ── Timeline events ─────────────────────────────────────
    const event = item.event;

    // report_intent → phase divider
    if (event.kind === 'tool-call' && event.toolName === 'report_intent') {
      const intentText =
        typeof event.toolArguments?.intent === 'string'
          ? event.toolArguments.intent
          : '';
      if (intentText) {
        result.push({ kind: 'intent-divider', intentText, event });
      }
      // Skip silently when intent text is empty
      i++;
      continue;
    }

    // Tool calls: group consecutive calls of the same tool
    if (event.kind === 'tool-call' && event.toolName) {
      const toolName = event.toolName;
      const group: RunTimelineEventRecord[] = [event];
      let j = i + 1;
      while (j < items.length) {
        const next = items[j];
        if (next.kind !== 'timeline-event') break;
        if (next.event.kind !== 'tool-call') break;
        if (next.event.toolName !== toolName) break;
        group.push(next.event);
        j++;
      }
      if (group.length === 1) {
        result.push({ kind: 'single-event', event: group[0] });
      } else {
        result.push({ kind: 'tool-group', toolName, events: group });
      }
      i = j;
      continue;
    }

    // Everything else: single event
    result.push({ kind: 'single-event', event });
    i++;
  }

  return result;
}

/* ── Extract the latest intent from events ─────────────────── */

export function extractLatestIntent(events: readonly RunTimelineEventRecord[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (
      e.kind === 'tool-call'
      && e.toolName === 'report_intent'
      && typeof e.toolArguments?.intent === 'string'
      && e.toolArguments.intent.trim()
    ) {
      return e.toolArguments.intent.trim();
    }
  }
  return undefined;
}

/* ── Generate a fallback summary from the tool mix ─────────── */

export function generateActivitySummary(events: readonly RunTimelineEventRecord[]): string | undefined {
  const toolCounts = new Map<string, number>();
  let editCount = 0;
  let searchCount = 0;
  let viewCount = 0;

  for (const e of events) {
    if (e.kind !== 'tool-call' || !e.toolName) continue;
    if (e.toolName === 'report_intent') continue;
    toolCounts.set(e.toolName, (toolCounts.get(e.toolName) ?? 0) + 1);

    if (e.toolName === 'edit' || e.toolName === 'create') editCount++;
    else if (e.toolName === 'grep' || e.toolName === 'glob' || e.toolName === 'lsp') searchCount++;
    else if (e.toolName === 'view') viewCount++;
  }

  const parts: string[] = [];
  if (searchCount > 0) parts.push(`searched ${searchCount} ${searchCount === 1 ? 'pattern' : 'patterns'}`);
  if (viewCount > 0) parts.push(`viewed ${viewCount} ${viewCount === 1 ? 'file' : 'files'}`);
  if (editCount > 0) parts.push(`edited ${editCount} ${editCount === 1 ? 'file' : 'files'}`);

  if (parts.length === 0) {
    const total = Array.from(toolCounts.values()).reduce((a, b) => a + b, 0);
    if (total > 0) return `${total} ${total === 1 ? 'action' : 'actions'}`;
    return undefined;
  }

  // Capitalize first part
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.join(', ');
}
