import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  ExternalLink,
  FileSearch,
  Github,
  MessageSquare,
  Pencil,
  Search,
  ShieldAlert,
  Terminal,
  Users,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react';

import { useElapsedTimer } from '@renderer/hooks/useElapsedTimer';
import { FileChangePreview } from '@renderer/components/chat/FileChangePreview';
import { ToolCallDetailPanel } from '@renderer/components/chat/ToolCallDetailPanel';
import { RunChangeSummaryCard } from '@renderer/components/chat/RunChangeSummaryCard';
import { formatEventLabel, truncateContent, filterEventsByAgent, summarizeActivity, type ActivitySummary } from '@renderer/lib/runTimelineFormatting';
import { formatToolGroupLabel, extractToolCallSnippet, formatToolCallPrimaryLabel } from '@renderer/lib/toolCallSummary';
import { buildActivityStream, groupActivityStream, extractLatestIntent, generateActivitySummary, type GroupedActivityItem } from '@renderer/lib/activityGrouping';
import type { ChatMessageRecord } from '@shared/domain/session';
import type { ProjectGitFileReference } from '@shared/domain/project';
import type { RunTimelineEventRecord, SessionRunRecord } from '@shared/domain/runTimeline';

/* ── Props ─────────────────────────────────────────────────── */

export interface TurnActivityPanelProps {
  thinkingMessages: ChatMessageRecord[];
  run?: SessionRunRecord;
  isActive: boolean;
  turnStartedAt?: string;
  sessionId: string;
  agentNames?: ReadonlySet<string>;
  isLastRunPanel?: boolean;
  onDiscard?: (sessionId: string, runId: string, files?: ProjectGitFileReference[]) => Promise<unknown>;
  onOpenCommitComposer?: () => void;
}

/* ── Helpers ───────────────────────────────────────────────── */

function truncatePreview(text: string, maxLength: number): string {
  const firstLine = text.split('\n')[0] ?? '';
  const cleaned = firstLine.trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}…`;
}

function formatSummaryParts(summary: ActivitySummary): string[] {
  const parts: string[] = [];
  if (summary.toolCalls > 0) {
    parts.push(`${summary.toolCalls} ${summary.toolCalls === 1 ? 'action' : 'actions'}`);
  }
  if (summary.handoffs > 0) {
    parts.push(`${summary.handoffs} ${summary.handoffs === 1 ? 'handoff' : 'handoffs'}`);
  }
  if (summary.approvals > 0) {
    parts.push(`${summary.approvals} ${summary.approvals === 1 ? 'approval' : 'approvals'}`);
  }
  return parts;
}

/* ── Tool-category icon ────────────────────────────────────── */

function ToolCategoryIcon({ toolName, className }: { toolName?: string; className?: string }) {
  const base = className ?? 'size-3 shrink-0';

  if (!toolName) return <Wrench className={`${base} text-[var(--color-text-muted)]`} />;

  if (toolName.startsWith('github-')) {
    return <Github className={`${base} text-[var(--color-text-secondary)]`} />;
  }

  switch (toolName) {
    case 'view':
      return <Eye className={`${base} text-[var(--color-accent-sky)]`} />;
    case 'grep':
    case 'glob':
      return <Search className={`${base} text-[var(--color-accent-purple)]`} />;
    case 'lsp':
      return <FileSearch className={`${base} text-[var(--color-accent-purple)]`} />;
    case 'edit':
    case 'create':
      return <Pencil className={`${base} text-[var(--color-status-warning)]`} />;
    case 'powershell':
      return <Terminal className={`${base} text-[var(--color-text-secondary)]`} />;
    case 'web_fetch':
    case 'web_search':
      return <ExternalLink className={`${base} text-[var(--color-accent-sky)]`} />;
    case 'sql':
      return <Database className={`${base} text-[var(--color-accent-purple)]`} />;
    case 'task':
      return <Users className={`${base} text-[var(--color-accent-sky)]`} />;
    default:
      return <Wrench className={`${base} text-[var(--color-text-muted)]`} />;
  }
}

/* ── Event icon (for non-tool events) ──────────────────────── */

function ActivityEventIcon({ kind, status, toolName }: {
  kind: RunTimelineEventRecord['kind'];
  status: RunTimelineEventRecord['status'];
  toolName?: string;
}) {
  const base = 'size-3 shrink-0';

  switch (kind) {
    case 'tool-call':
      return <ToolCategoryIcon toolName={toolName} className={base} />;
    case 'approval':
      return (
        <ShieldAlert
          className={`${base} ${
            status === 'error'
              ? 'text-[var(--color-status-error)]'
              : status === 'running'
                ? 'text-[var(--color-status-warning)]'
                : 'text-[var(--color-status-success)]'
          }`}
        />
      );
    case 'handoff':
      return <ArrowRight className={`${base} text-[var(--color-status-warning)]`} />;
    case 'message':
      return <MessageSquare className={`${base} text-[var(--color-accent-sky)]`} />;
    case 'run-completed':
      return <CheckCircle2 className={`${base} text-[var(--color-status-success)]`} />;
    case 'run-cancelled':
      return <XCircle className={`${base} text-[var(--color-text-muted)]`} />;
    case 'run-failed':
      return <AlertTriangle className={`${base} text-[var(--color-status-error)]`} />;
    default:
      return <Zap className={`${base} text-[var(--color-text-muted)]`} />;
  }
}

/* ── Single event row ──────────────────────────────────────── */

function ActivityTimelineEventRow({ event }: { event: RunTimelineEventRecord }) {
  const label = formatEventLabel(event);
  const isTerminal = event.kind === 'run-completed' || event.kind === 'run-cancelled' || event.kind === 'run-failed';

  return (
    <div className="turn-activity-row flex gap-2 py-1">
      <div className="mt-0.5 flex shrink-0 items-start">
        <ActivityEventIcon kind={event.kind} status={event.status} toolName={event.toolName} />
      </div>
      <div className="min-w-0 flex-1">
        <span className={`text-[12px] font-medium ${isTerminal ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'}`}>
          {label}
        </span>

        {/* Approval kind badge */}
        {event.kind === 'approval' && event.approvalKind && (
          <span
            className={`ml-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${
              event.status === 'running'
                ? 'bg-[var(--color-status-warning)]/15 text-[var(--color-status-warning)]'
                : event.status === 'completed'
                  ? 'bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]'
                  : 'bg-[var(--color-status-error)]/15 text-[var(--color-status-error)]'
            }`}
          >
            {event.approvalKind === 'final-response' ? 'response' : 'tool'}
          </span>
        )}

        {/* Content preview for message events */}
        {event.kind === 'message' && event.content && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
            {truncateContent(event.content, 120)}
          </p>
        )}

        {/* Approval detail */}
        {event.kind === 'approval' && event.approvalDetail && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
            {truncateContent(event.approvalDetail, 120)}
          </p>
        )}

        {/* Error detail */}
        {event.error && (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-status-error)]/80">
            {truncateContent(event.error, 120)}
          </p>
        )}

        {/* Tool call argument details */}
        {event.kind === 'tool-call' && (
          <ToolCallDetailPanel toolName={event.toolName} toolArguments={event.toolArguments} />
        )}

        {/* File change preview for tool-call events */}
        {event.kind === 'tool-call' && event.fileChanges && event.fileChanges.length > 0 && (
          <div className="mt-1">
            <FileChangePreview fileChanges={event.fileChanges} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Grouped tool-call row ─────────────────────────────────── */

function GroupedToolCallRow({ toolName, events }: { toolName: string; events: RunTimelineEventRecord[] }) {
  const [expanded, setExpanded] = useState(false);
  const label = formatToolGroupLabel(toolName, events.length);

  const snippets = useMemo(
    () => events.map((e) => extractToolCallSnippet(toolName, e.toolArguments)).filter(Boolean) as string[],
    [toolName, events],
  );

  const hasFileChanges = events.some((e) => e.fileChanges && e.fileChanges.length > 0);

  return (
    <div className="turn-activity-row py-0.5">
      <button
        type="button"
        className="flex w-full items-start gap-2 py-1 text-left transition-colors hover:bg-[var(--color-surface-2)]/30 rounded px-1 -mx-1"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <div className="mt-0.5 flex shrink-0 items-start">
          <ToolCategoryIcon toolName={toolName} />
        </div>
        <span className="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-text-secondary)]">
          {label}
        </span>
        <ChevronRight
          className={`mt-0.5 size-3 shrink-0 text-[var(--color-text-muted)] transition-transform duration-150 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
      </button>

      {/* Collapsed preview: show snippets inline */}
      {!expanded && snippets.length > 0 && (
        <div className="ml-5 flex flex-wrap gap-x-2 gap-y-0.5 pb-0.5">
          {snippets.slice(0, 6).map((s, i) => (
            <span key={i} className="truncate font-mono text-[10px] text-[var(--color-text-muted)]">
              {s}
            </span>
          ))}
          {snippets.length > 6 && (
            <span className="text-[10px] text-[var(--color-text-muted)]">
              +{snippets.length - 6} more
            </span>
          )}
        </div>
      )}

      {/* Expanded: full per-event rows */}
      {expanded && (
        <div className="ml-5 border-l border-[var(--color-border)]/30 pl-2">
          {events.map((event) => (
            <div key={event.id} className="py-0.5">
              <span className="text-[11px] text-[var(--color-text-secondary)]">
                {formatToolCallPrimaryLabel(event.toolName, event.toolArguments)}
              </span>
              <ToolCallDetailPanel toolName={event.toolName} toolArguments={event.toolArguments} />
              {event.fileChanges && event.fileChanges.length > 0 && (
                <div className="mt-0.5">
                  <FileChangePreview fileChanges={event.fileChanges} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Aggregate file changes when collapsed */}
      {!expanded && hasFileChanges && (
        <div className="ml-5 mt-0.5">
          {events
            .filter((e) => e.fileChanges && e.fileChanges.length > 0)
            .flatMap((e) => e.fileChanges!)
            .length > 0 && (
            <FileChangePreview
              fileChanges={events.flatMap((e) => e.fileChanges ?? [])}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ── Intent divider ────────────────────────────────────────── */

function IntentDividerRow({ text }: { text: string }) {
  return (
    <div className="turn-activity-row flex items-center gap-2 py-1.5" role="separator">
      <div className="h-px flex-1 bg-[var(--color-border)]/40" />
      <span className="shrink-0 text-[10px] font-medium tracking-wide text-[var(--color-text-muted)]">
        {text}
      </span>
      <div className="h-px flex-1 bg-[var(--color-border)]/40" />
    </div>
  );
}

/* ── Thinking step row ─────────────────────────────────────── */

function ThinkingStepRow({ message }: { message: ChatMessageRecord }) {
  const preview = useMemo(() => truncatePreview(message.content, 180), [message.content]);

  if (message.pending && !message.content) return null;

  return (
    <div className="turn-activity-row flex gap-2 py-1">
      <div className="mt-0.5 flex shrink-0 items-start">
        <Brain className="size-3 text-[var(--color-accent-purple)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="border-l-2 border-[var(--color-accent-purple)]/20 pl-2 text-[11px] italic leading-snug text-[var(--color-text-muted)]">
          "{preview}"
        </p>
      </div>
    </div>
  );
}

/* ── Thinking group (multiple consecutive) ─────────────────── */

function ThinkingGroupRow({ messages }: { messages: ChatMessageRecord[] }) {
  const [expanded, setExpanded] = useState(false);

  const visibleMessages = messages.filter((m) => !m.pending || m.content);
  if (visibleMessages.length === 0) return null;

  const latest = visibleMessages[visibleMessages.length - 1];
  const preview = truncatePreview(latest.content, 180);
  const hiddenCount = visibleMessages.length - 1;

  return (
    <div className="turn-activity-row py-0.5">
      <div className="flex gap-2 py-1">
        <div className="mt-0.5 flex shrink-0 items-start">
          <Brain className="size-3 text-[var(--color-accent-purple)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="border-l-2 border-[var(--color-accent-purple)]/20 pl-2 text-[11px] italic leading-snug text-[var(--color-text-muted)]">
            "{preview}"
          </p>
          {hiddenCount > 0 && (
            <button
              type="button"
              className="mt-0.5 pl-2 text-[10px] text-[var(--color-accent)] hover:underline"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? 'Hide' : `${hiddenCount} earlier ${hiddenCount === 1 ? 'thought' : 'thoughts'}`}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="ml-5 space-y-0.5 border-l border-[var(--color-border)]/30 pl-2">
          {visibleMessages.slice(0, -1).map((msg) => (
            <p key={msg.id} className="text-[10px] italic leading-snug text-[var(--color-text-muted)]">
              "{truncatePreview(msg.content, 140)}"
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Active pulse dots ─────────────────────────────────────── */

function ActivityPulse() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent)]" />
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent)]" />
      <span className="thinking-dot size-1 rounded-full bg-[var(--color-accent)]" />
    </span>
  );
}

/* ── Grouped item renderer ─────────────────────────────────── */

function GroupedItemRow({ item }: { item: GroupedActivityItem }) {
  switch (item.kind) {
    case 'intent-divider':
      return <IntentDividerRow text={item.intentText} />;
    case 'single-event':
      return <ActivityTimelineEventRow event={item.event} />;
    case 'tool-group':
      return <GroupedToolCallRow toolName={item.toolName} events={item.events} />;
    case 'single-thinking':
      return <ThinkingStepRow message={item.message} />;
    case 'thinking-group':
      return <ThinkingGroupRow messages={item.messages} />;
  }
}

/* ── Main component ────────────────────────────────────────── */

export function TurnActivityPanel({
  thinkingMessages,
  run,
  isActive,
  turnStartedAt,
  sessionId,
  agentNames,
  isLastRunPanel,
  onDiscard,
  onOpenCommitComposer,
}: TurnActivityPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const wasActiveRef = useRef(isActive);

  useEffect(() => {
    if (isActive && (thinkingMessages.length > 0 || run)) {
      setExpanded(true);
    } else if (wasActiveRef.current && !isActive) {
      setExpanded(false);
    }
    wasActiveRef.current = isActive;
  }, [isActive, thinkingMessages.length, run]);

  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const scopedEvents = useMemo(
    () => filterEventsByAgent(run?.events ?? [], agentNames),
    [run?.events, agentNames],
  );

  const effectiveTurnStartedAt = useMemo(() => {
    if (!agentNames || agentNames.size === 0 || scopedEvents.length === 0) {
      return turnStartedAt;
    }
    let earliest = turnStartedAt;
    for (const e of scopedEvents) {
      if (!earliest || e.occurredAt < earliest) {
        earliest = e.occurredAt;
        break;
      }
    }
    return earliest;
  }, [agentNames, scopedEvents, turnStartedAt]);

  const elapsed = useElapsedTimer(
    thinkingMessages.length > 0 || run ? effectiveTurnStartedAt : undefined,
    isActive,
  );

  const summary = useMemo(
    () => summarizeActivity(thinkingMessages, scopedEvents),
    [thinkingMessages, scopedEvents],
  );

  const groupedItems = useMemo(() => {
    const stream = buildActivityStream(thinkingMessages, scopedEvents);
    return groupActivityStream(stream);
  }, [thinkingMessages, scopedEvents]);

  // Extract intent text for the header
  const intentText = useMemo(() => extractLatestIntent(scopedEvents), [scopedEvents]);
  const fallbackSummary = useMemo(
    () => !intentText ? generateActivitySummary(scopedEvents) : undefined,
    [intentText, scopedEvents],
  );

  if (thinkingMessages.length === 0 && !run) {
    return null;
  }

  const summaryParts = formatSummaryParts(summary);
  const runStatus = run?.status;
  const isCompleted = runStatus === 'completed';
  const isFailed = runStatus === 'error';
  const isCancelled = runStatus === 'cancelled';
  const isTerminated = isCompleted || isFailed || isCancelled;
  const showGitSummary = run && isTerminated && run.postRunGitSummary && onDiscard && (isLastRunPanel !== false);

  let summaryLabel: string;
  if (isActive) {
    summaryLabel = 'Working';
  } else if (isFailed) {
    summaryLabel = elapsed ? `Failed after ${elapsed}` : 'Failed';
  } else if (isCancelled) {
    summaryLabel = elapsed ? `Cancelled after ${elapsed}` : 'Cancelled';
  } else if (elapsed) {
    summaryLabel = `Completed in ${elapsed}`;
  } else {
    summaryLabel = 'Completed';
  }

  const headerDetail = intentText ?? fallbackSummary;

  const statusColorClass = isFailed
    ? 'text-[var(--color-status-error)]'
    : isCancelled
      ? 'text-[var(--color-text-muted)]'
      : isActive
        ? 'text-[var(--color-text-secondary)]'
        : 'text-[var(--color-text-secondary)]';

  return (
    <div
      className={`turn-activity-enter overflow-hidden rounded-lg border bg-[var(--color-surface-1)]/60 transition-colors duration-200 ${
        isActive
          ? 'border-[var(--color-accent)]/30'
          : isFailed
            ? 'border-[var(--color-status-error)]/20'
            : 'border-[var(--color-border)]/50'
      }`}
    >
      {/* Summary header */}
      <button
        type="button"
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); toggle(); } }}
        aria-expanded={expanded}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--color-surface-2)]/50 ${
          isActive ? 'bg-[var(--color-accent)]/[0.04]' : ''
        }`}
      >
        <Zap className={`size-3.5 shrink-0 ${isActive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'}`} />

        {isActive ? (
          <span className="flex items-center gap-1.5">
            <span className={statusColorClass}>{summaryLabel}</span>
            <ActivityPulse />
          </span>
        ) : (
          <span className={statusColorClass}>{summaryLabel}</span>
        )}

        {/* Intent / generated summary */}
        {headerDetail && (
          <span className="min-w-0 truncate text-[11px] text-[var(--color-text-muted)]">
            {'· '}
            {intentText ? `"${headerDetail}"` : headerDetail}
          </span>
        )}

        {/* Inline counters */}
        {summaryParts.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
            {'· '}
            {summaryParts.join(' · ')}
          </span>
        )}

        <span className="ml-auto shrink-0">
          {expanded
            ? <ChevronDown className="size-3 text-[var(--color-text-muted)]" />
            : <ChevronRight className="size-3 text-[var(--color-text-muted)]" />}
        </span>
      </button>

      {/* Expanded activity stream — grouped */}
      {expanded && (
        <div className="border-t border-[var(--color-border)]/30 px-3 py-2">
          <div className="space-y-0.5">
            {groupedItems.map((item, index) => (
              <GroupedItemRow key={index} item={item} />
            ))}
          </div>

          {/* Post-run git changes */}
          {showGitSummary && (
            <div className="mt-2 border-t border-[var(--color-border)]/30 pt-2">
              <RunChangeSummaryCard
                onDiscard={onDiscard}
                onOpenCommitComposer={onOpenCommitComposer}
                runId={run.requestId}
                sessionId={sessionId}
                summary={run.postRunGitSummary!}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
