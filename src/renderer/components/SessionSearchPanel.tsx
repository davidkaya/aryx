import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, MessageSquare, ArrowRight } from 'lucide-react';

import type { WorkspaceState } from '@shared/domain/workspace';
import type { ChatMessageRecord, SessionRecord } from '@shared/domain/session';
import { isScratchpadProject } from '@shared/domain/project';

export interface SessionSearchPanelProps {
  workspace: WorkspaceState;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
}

interface SearchHit {
  session: SessionRecord;
  projectName: string;
  message: ChatMessageRecord;
  /** The matching substring context around the first token hit. */
  snippet: string;
  /** Character offset of the match within the snippet for highlighting. */
  matchStart: number;
  matchLength: number;
}

function extractSnippet(content: string, query: string): { snippet: string; matchStart: number; matchLength: number } | undefined {
  const lower = content.toLowerCase();
  const qLower = query.toLowerCase().trim();
  if (!qLower) return undefined;

  // Find first occurrence of query in content
  const idx = lower.indexOf(qLower);
  if (idx === -1) {
    // Try individual tokens
    const tokens = qLower.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const tidx = lower.indexOf(token);
      if (tidx !== -1) {
        const start = Math.max(0, tidx - 40);
        const end = Math.min(content.length, tidx + token.length + 80);
        const snippet = (start > 0 ? '…' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '…' : '');
        const adjustedStart = (start > 0 ? 1 : 0) + (tidx - start);
        return { snippet, matchStart: adjustedStart, matchLength: token.length };
      }
    }
    return undefined;
  }

  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + qLower.length + 80);
  const snippet = (start > 0 ? '…' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '…' : '');
  const adjustedStart = (start > 0 ? 1 : 0) + (idx - start);
  return { snippet, matchStart: adjustedStart, matchLength: qLower.length };
}

export function SessionSearchPanel({ workspace, onClose, onSelectSession }: SessionSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

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

  // Build project name lookup
  const projectNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of workspace.projects) {
      map.set(p.id, isScratchpadProject(p) ? 'Scratchpad' : p.name);
    }
    return map;
  }, [workspace.projects]);

  // Search across all sessions and messages
  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim();
    if (!q) return [];

    const results: SearchHit[] = [];
    const activeSessions = workspace.sessions.filter((s) => !s.isArchived);

    for (const session of activeSessions) {
      for (const message of session.messages) {
        if (!message.content) continue;
        const extracted = extractSnippet(message.content, q);
        if (extracted) {
          results.push({
            session,
            projectName: projectNames.get(session.projectId) ?? 'Unknown',
            message,
            ...extracted,
          });
        }
      }
    }

    // Limit results for performance and sort by session recency
    return results.slice(0, 50);
  }, [query, workspace.sessions, projectNames]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const handleSelect = useCallback((hit: SearchHit) => {
    onClose();
    onSelectSession(hit.session.id);
    // After navigation, scroll to the matching message
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
    const item = listRef.current?.querySelector(`[data-search-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div
      className="palette-backdrop-enter fixed inset-0 z-[60] flex justify-center bg-[#07080e]/80 pt-[15vh] backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search sessions"
    >
      <div
        className="palette-enter glow-border flex h-fit max-h-[min(520px,65vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-[var(--color-surface-1)] shadow-[0_16px_64px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
          <Search className="size-4 shrink-0 text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent py-3.5 text-[14px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
            placeholder="Search across all sessions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search session content"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <span className="shrink-0 text-[11px] text-[var(--color-text-muted)]">
              {hits.length} result{hits.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5" role="listbox">
          {query && hits.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
              No matches found
            </div>
          ) : !query ? (
            <div className="px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
              Type to search across all session messages
            </div>
          ) : (
            hits.map((hit, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={`${hit.session.id}-${hit.message.id}`}
                  data-search-index={index}
                  className={`flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors ${
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
                  {/* Session title row */}
                  <div className="flex items-center gap-2">
                    <MessageSquare className={`size-3.5 shrink-0 ${isSelected ? 'text-[var(--color-text-accent)]' : 'text-[var(--color-text-muted)]'}`} />
                    <span className="truncate text-[12px] font-medium">{hit.session.title}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)]">·</span>
                    <span className="truncate text-[10px] text-[var(--color-text-muted)]">{hit.projectName}</span>
                    <ArrowRight className="ml-auto size-3 shrink-0 text-[var(--color-text-muted)]" />
                  </div>
                  {/* Message snippet with highlighted match */}
                  <div className="pl-5.5 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                    <span className="line-clamp-2">
                      {hit.snippet.slice(0, hit.matchStart)}
                      <mark className="rounded-sm bg-[var(--color-accent)]/20 px-0.5 text-[var(--color-text-accent)]">
                        {hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)}
                      </mark>
                      {hit.snippet.slice(hit.matchStart + hit.matchLength)}
                    </span>
                  </div>
                  <div className="pl-5.5 text-[10px] text-[var(--color-text-muted)]">
                    {hit.message.role === 'user' ? 'You' : hit.message.authorName}
                  </div>
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
