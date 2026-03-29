import { useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, ShieldAlert, ShieldBan, ShieldCheck, X } from 'lucide-react';

import { MarkdownContent } from '@renderer/components/MarkdownContent';
import { permissionDetailSummary, PermissionDetailView } from '@renderer/components/chat/PermissionDetailView';
import { resolveApprovalToolKey } from '@shared/domain/approval';
import type { ApprovalDecision, PendingApprovalRecord } from '@shared/domain/approval';
import { resolveToolLabel } from '@shared/domain/tooling';

/* ── ApprovalBanner ────────────────────────────────────────── */

export function ApprovalBanner({
  approval,
  onResolve,
  isResolving,
  position,
  total,
}: {
  approval: PendingApprovalRecord;
  onResolve: (decision: ApprovalDecision, alwaysApprove?: boolean) => void;
  isResolving: boolean;
  position?: number;
  total?: number;
}) {
  const kindLabel = approval.kind === 'final-response' ? 'Final response review' : 'Tool call approval';
  const hasMessages = approval.messages && approval.messages.length > 0;
  const showPosition = position !== undefined && total !== undefined && total > 1;
  const approvalToolKey = resolveApprovalToolKey(approval.toolName, approval.permissionKind);
  const canAlwaysApprove = approval.kind === 'tool-call' && !!approvalToolKey;
  const approvalToolLabel = approvalToolKey ? resolveToolLabel(approvalToolKey) : undefined;

  return (
    <div className="rounded-xl border border-[var(--color-glass-border)] border-l-4 border-l-[var(--color-status-warning)] bg-[var(--color-glass)] px-4 py-3" role="alert">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--color-status-warning)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--color-status-warning)]">{approval.title}</span>
            <span className="rounded-full bg-[var(--color-status-warning)]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-status-warning)]">
              {kindLabel}
            </span>
            {showPosition && (
              <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[9px] font-semibold tabular-nums text-[var(--color-text-secondary)]">
                {position} of {total}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
            {approval.agentName && <span>Agent: <span className="text-[var(--color-text-primary)]">{approval.agentName}</span></span>}
            {approval.toolName && <span>Tool: <span className="text-[var(--color-text-primary)]">{approval.toolName}</span></span>}
            {approval.permissionKind && <span>Permission: <span className="text-[var(--color-text-primary)]">{approval.permissionKind}</span></span>}
          </div>

          {approval.permissionDetail
            ? <PermissionDetailView detail={approval.permissionDetail} />
            : approval.detail && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-text-secondary)]">{approval.detail}</p>
            )}
        </div>
      </div>

      {/* Final-response message preview */}
      {hasMessages && (
        <div className="mt-3 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Pending messages — not yet published
          </p>
          {approval.messages!.map((message) => (
            <div className="mt-2" key={message.id}>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-[var(--color-text-muted)]">
                <Bot className="size-3" />
                <span>{message.authorName}</span>
              </div>
              <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/60 px-3 py-2 text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                <MarkdownContent content={message.content} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          className="brand-gradient-bg inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-medium text-white transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isResolving}
          onClick={() => onResolve('approved')}
          type="button"
        >
          {isResolving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Approve
        </button>
        {canAlwaysApprove && (
          <button
            aria-label={`Always approve ${approvalToolLabel}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-status-success)]/15 px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-status-success)] transition-all duration-200 hover:bg-[var(--color-status-success)]/25 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isResolving}
            onClick={() => onResolve('approved', true)}
            title={`Auto-approve "${approvalToolLabel}" for the rest of this session`}
            type="button"
          >
            <ShieldBan className="size-3" />
            Always approve
          </button>
        )}
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-2)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-text-secondary)] transition-all duration-200 hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isResolving}
          onClick={() => onResolve('rejected')}
          type="button"
        >
          <X className="size-3" />
          Reject
        </button>
        {showPosition && (
          <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
            Next approval will appear after this one is resolved
          </span>
        )}
      </div>
    </div>
  );
}

/* ── QueuedApprovalsList ───────────────────────────────────── */

export function QueuedApprovalsList({ approvals }: { approvals: PendingApprovalRecord[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass)] px-3 py-2">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <ShieldCheck className="size-3 text-[var(--color-text-muted)]" />
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
          {approvals.length} queued approval{approvals.length === 1 ? '' : 's'}
        </span>
        <ChevronDown
          className={`ml-auto size-3 text-[var(--color-text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-[var(--color-border-subtle)] pt-2">
          {approvals.map((approval) => {
            const kindLabel = approval.kind === 'final-response' ? 'response' : 'tool';
            return (
              <div
                className="flex items-center gap-2 rounded-md bg-[var(--color-surface-2)]/40 px-2.5 py-1.5"
                key={approval.id}
              >
                <ShieldAlert className="size-3 shrink-0 text-[var(--color-text-muted)]" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-text-secondary)]">
                  {(approval.permissionDetail && permissionDetailSummary(approval.permissionDetail)) || approval.title}
                </span>
                <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {kindLabel}
                </span>
                {approval.toolName && (
                  <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">{approval.toolName}</span>
                )}
                {approval.agentName && (
                  <span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">{approval.agentName}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
