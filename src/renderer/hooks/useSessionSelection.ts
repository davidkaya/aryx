import { useCallback, useRef, useState } from 'react';

export interface SessionSelectionState {
  /** Currently selected session IDs */
  selectedIds: Set<string>;
  /** Whether multi-select mode is active */
  isSelecting: boolean;
  /** Toggle a single session's selection */
  toggle: (sessionId: string) => void;
  /** Shift+click range selection: selects everything between the last anchor and the target */
  rangeSelect: (sessionId: string, allVisibleIds: string[]) => void;
  /** Select all provided session IDs */
  selectAll: (sessionIds: string[]) => void;
  /** Deselect all */
  deselectAll: () => void;
  /** Enter multi-select mode with an initial selection */
  enterSelectionMode: (initialId: string) => void;
  /** Exit multi-select mode and clear selection */
  exitSelectionMode: () => void;
  /** Check if a session is selected */
  isSelected: (sessionId: string) => boolean;
}

export function useSessionSelection(): SessionSelectionState {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  // Tracks the last explicitly toggled session for shift+click range behaviour
  const anchorRef = useRef<string | null>(null);

  const enterSelectionMode = useCallback((initialId: string) => {
    setIsSelecting(true);
    setSelectedIds(new Set([initialId]));
    anchorRef.current = initialId;
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
    anchorRef.current = null;
  }, []);

  const toggle = useCallback((sessionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      anchorRef.current = sessionId;
      return next;
    });
  }, []);

  const rangeSelect = useCallback((sessionId: string, allVisibleIds: string[]) => {
    const anchor = anchorRef.current;
    if (!anchor) {
      // No anchor yet — treat as a simple toggle
      setSelectedIds(new Set([sessionId]));
      anchorRef.current = sessionId;
      return;
    }

    const anchorIdx = allVisibleIds.indexOf(anchor);
    const targetIdx = allVisibleIds.indexOf(sessionId);
    if (anchorIdx === -1 || targetIdx === -1) return;

    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    const rangeIds = allVisibleIds.slice(start, end + 1);

    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of rangeIds) {
        next.add(id);
      }
      return next;
    });
    // Anchor stays the same for contiguous range extension
  }, []);

  const selectAll = useCallback((sessionIds: string[]) => {
    setSelectedIds(new Set(sessionIds));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((sessionId: string) => selectedIds.has(sessionId), [selectedIds]);

  return {
    selectedIds,
    isSelecting,
    toggle,
    rangeSelect,
    selectAll,
    deselectAll,
    enterSelectionMode,
    exitSelectionMode,
    isSelected,
  };
}
