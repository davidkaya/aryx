import { useState } from 'react';
import { Bot, Check, ChevronDown, Loader2, ShieldAlert, ShieldBan, ShieldCheck, X } from 'lucide-react';

import { MarkdownContent } from '@renderer/components/MarkdownContent';
import { permissionDetailSummary, PermissionDetailView } from '@renderer/components/chat/PermissionDetailView';
import type { ApprovalDecision, PendingApprovalRecord } from '@shared/domain/approval';

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
  const approvalToolKey = approval.toolName ?? approval.permissionKind;
  const canAlwaysApprove = approval.kind === 'tool-call' && !!approvalToolKey;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3" role="alert">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-amber-200">{approval.title}</span>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400">
              {kindLabel}
            </span>
            {showPosition && (
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] font-semibold tabular-nums text-zinc-400">
                {position} of {total}
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            {approval.agentName && <span>Agent: <span className="text-zinc-300">{approval.agentName}</span></span>}
            {approval.toolName && <span>Tool: <span className="text-zinc-300">{approval.toolName}</span></span>}
            {approval.permissionKind && <span>Permission: <span className="text-zinc-300">{approval.permissionKind}</span></span>}
          </div>

          {approval.permissionDetail
            ? <PermissionDetailView detail={approval.permissionDetail} />
            : approval.detail && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">{approval.detail}</p>
            )}
        </div>
      </div>

      {/* Final-response message preview */}
      {hasMessages && (
        <div className="mt-3 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Pending messages — not yet published
          </p>
          {approval.messages!.map((message) => (
            <div className="mt-2" key={message.id}>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-zinc-500">
                <Bot className="size-3" />
                <span>{message.authorName}</span>
              </div>
              <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-[13px] leading-relaxed text-zinc-300">
                <MarkdownContent content={message.content} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isResolving}
          onClick={() => onResolve('approved')}
          type="button"
        >
          {isResolving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Approve
        </button>
        {canAlwaysApprove && (
          <button
            aria-label={`Always approve ${approvalToolKey}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3.5 py-1.5 text-[12px] font-medium text-emerald-300 transition hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isResolving}
            onClick={() => onResolve('approved', true)}
            title={`Auto-approve "${approvalToolKey}" for the rest of this session`}
            type="button"
          >
            <ShieldBan className="size-3" />
            Always approve
          </button>
        )}
        <button
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3.5 py-1.5 text-[12px] font-medium text-zinc-300 transition hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isResolving}
          onClick={() => onResolve('rejected')}
          type="button"
        >
          <X className="size-3" />
          Reject
        </button>
        {showPosition && (
          <span className="ml-auto text-[10px] text-zinc-600">
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <ShieldCheck className="size-3 text-zinc-500" />
        <span className="text-[11px] font-medium text-zinc-400">
          {approvals.length} queued approval{approvals.length === 1 ? '' : 's'}
        </span>
        <ChevronDown
          className={`ml-auto size-3 text-zinc-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 border-t border-zinc-800/60 pt-2">
          {approvals.map((approval) => {
            const kindLabel = approval.kind === 'final-response' ? 'response' : 'tool';
            return (
              <div
                className="flex items-center gap-2 rounded-md bg-zinc-800/40 px-2.5 py-1.5"
                key={approval.id}
              >
                <ShieldAlert className="size-3 shrink-0 text-zinc-600" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">
                  {(approval.permissionDetail && permissionDetailSummary(approval.permissionDetail)) || approval.title}
                </span>
                <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-zinc-500">
                  {kindLabel}
                </span>
                {approval.toolName && (
                  <span className="shrink-0 text-[10px] text-zinc-500">{approval.toolName}</span>
                )}
                {approval.agentName && (
                  <span className="shrink-0 text-[10px] text-zinc-600">{approval.agentName}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
