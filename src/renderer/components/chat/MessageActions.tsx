import { useState } from 'react';
import { Bookmark, Check, ClipboardCopy, GitBranch, Pencil, RefreshCw } from 'lucide-react';

import type { ChatMessageRecord } from '@shared/domain/session';

export interface MessageActionsProps {
  message: ChatMessageRecord;
  isLastAssistant: boolean;
  onCopy: () => void;
  onPin: () => void;
  onBranch: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
}

export function MessageActions({
  message,
  isLastAssistant,
  onCopy,
  onPin,
  onBranch,
  onRegenerate,
  onEdit,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isPinned = !!message.isPinned;

  function handleCopy() {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div
      className="msg-actions-enter flex items-center gap-0.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]/90 px-1 py-0.5 opacity-0 shadow-sm backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100"
      role="toolbar"
      aria-label="Message actions"
    >
      {/* Copy */}
      <ActionButton
        icon={copied ? <Check className="size-3 text-[var(--color-status-success)]" /> : <ClipboardCopy className="size-3" />}
        label={copied ? 'Copied' : 'Copy as markdown'}
        onClick={handleCopy}
      />

      {/* Pin / Unpin */}
      <ActionButton
        icon={
          <Bookmark
            className={`size-3 ${isPinned ? 'fill-[var(--color-accent-sky)] text-[var(--color-accent-sky)]' : ''}`}
          />
        }
        label={isPinned ? 'Unpin message' : 'Pin message'}
        onClick={onPin}
        active={isPinned}
      />

      {/* Edit (user messages only) */}
      {isUser && onEdit && (
        <ActionButton
          icon={<Pencil className="size-3" />}
          label="Edit &amp; resend"
          onClick={onEdit}
        />
      )}

      {/* Regenerate (last assistant only) */}
      {!isUser && isLastAssistant && onRegenerate && (
        <ActionButton
          icon={<RefreshCw className="size-3" />}
          label="Regenerate response"
          onClick={onRegenerate}
        />
      )}

      {/* Branch */}
      <ActionButton
        icon={<GitBranch className="size-3" />}
        label={isUser ? 'Branch from this message' : 'Branch from this response'}
        onClick={onBranch}
      />
    </div>
  );
}

/* ── Small action button ────────────────────────────────────── */

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}

function ActionButton({ icon, label, onClick, active }: ActionButtonProps) {
  return (
    <button
      aria-label={label}
      className={`flex size-6 items-center justify-center rounded-md transition-all duration-100 ${
        active
          ? 'text-[var(--color-accent-sky)]'
          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-primary)]'
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  );
}
