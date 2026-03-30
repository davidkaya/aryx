import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkMinus, ArrowRight } from 'lucide-react';

import type { WorkspaceState } from '@shared/domain/workspace';
import { listPinnedMessages, type PinnedMessageHit } from '@shared/domain/sessionLibrary';

export interface BookmarksPanelProps {
  workspace: WorkspaceState;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  onUnpinMessage: (sessionId: string, messageId: string) => void;
}

export function BookmarksPanel({ workspace, onClose, onSelectSession, onUnpinMessage }: BookmarksPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Escape to close in capture phase
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [onClose]);

  const hits = useMemo<PinnedMessageHit[]>(
    () => listPinnedMessages(workspace),
    [workspace],
  );

  // Clamp selected index when items are removed
  useEffect(() => {
    if (hits.length > 0 && selectedIndex >= hits.length) {
      setSelectedIndex(hits.length - 1);
    }
  }, [hits.length, selectedIndex]);

  const handleSelect = useCallback((hit: PinnedMessageHit) => {
    onClose();
    onSelectSession(hit.session.id);
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.querySelector(`[data-message-id="${CSS.escape(hit.message.id)}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-1', 'ring-[var(--color-accent)]/40', 'rounded-lg');
          setTimeout(() => el.classList.remove('ring-1', 'ring-[var(--color-accent)]/40', 'rounded-lg'), 2000);
        }
      }, 100);
    });
  }, [onClose, onSelectSession]);

  const handleUnpin = useCallback((e: React.MouseEvent, hit: PinnedMessageHit) => {
    e.stopPropagation();
    onUnpinMessage(hit.session.id, hit.message.id);
  }, [onUnpinMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (hits.length > 0) setSelectedIndex((i) => Math.min(i + 1, hits.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = hits[selectedIndex];
        if (hit) handleSelect(hit);
      }
    },
    [hits, selectedIndex, handleSelect],
  );

  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-bookmark-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div
      className="palette-backdrop-enter fixed inset-0 z-[60] flex justify-center bg-[#07080e]/80 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Bookmarks"
    >
      <div
        className="palette-enter glow-border flex h-fit max-h-[min(520px,65vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-[var(--color-surface-1)] shadow-[0_16px_64px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3.5">
          <Bookmark className="size-4 shrink-0 text-[var(--color-text-accent)]" />
          <span className="text-[14px] font-medium text-[var(--color-text-primary)]">
            Bookmarks
          </span>
          <span className="text-[11px] text-[var(--color-text-muted)]">
            {hits.length} {hits.length === 1 ? 'message' : 'messages'}
          </span>
        </div>

        {/* List */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5" role="listbox">
          {hits.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Bookmark className="size-6 text-[var(--color-text-muted)]/40" />
              <span className="text-[13px] text-[var(--color-text-muted)]">
                No bookmarked messages yet
              </span>
              <span className="text-[11px] text-[var(--color-text-muted)]/60">
                Pin messages from any session to save them here
              </span>
            </div>
          ) : (
            hits.map((hit, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={`${hit.session.id}-${hit.message.id}`}
                  data-bookmark-index={index}
                  className={`group/row flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-[var(--color-accent-muted)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-glass-hover)] hover:text-[var(--color-text-primary)]'
                  }`}
                  onClick={() => handleSelect(hit)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  role="option"
                  aria-selected={isSelected}
                  type="button"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {/* Session title row */}
                    <div className="flex items-center gap-2">
                      <Bookmark
                        className={`size-3.5 shrink-0 fill-[var(--color-accent-sky)] text-[var(--color-accent-sky)]`}
                      />
                      <span className="truncate text-[12px] font-medium">{hit.session.title}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">·</span>
                      <span className="truncate text-[10px] text-[var(--color-text-muted)]">{hit.projectName}</span>
                      <ArrowRight className="ml-auto size-3 shrink-0 text-[var(--color-text-muted)]" />
                    </div>
                    {/* Message snippet */}
                    <div className="pl-5.5 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                      <span className="line-clamp-2">{hit.snippet}</span>
                    </div>
                    <div className="pl-5.5 text-[10px] text-[var(--color-text-muted)]">
                      {hit.message.role === 'user' ? 'You' : hit.message.authorName}
                    </div>
                  </div>

                  {/* Unpin button */}
                  <button
                    className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] opacity-0 transition-all duration-100 hover:bg-[var(--color-surface-2)] hover:text-[var(--color-status-error)] group-hover/row:opacity-100"
                    onClick={(e) => handleUnpin(e, hit)}
                    aria-label={`Unpin message from ${hit.session.title}`}
                    title="Remove bookmark"
                    type="button"
                  >
                    <BookmarkMinus className="size-3.5" />
                  </button>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border-subtle)] px-1 font-mono text-[10px]">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border-subtle)] px-1 font-mono text-[10px]">↵</kbd>
            jump to message
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--color-border-subtle)] px-1 font-mono text-[10px]">esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
