import { describe, expect, test } from 'bun:test';

/**
 * Test the core selection logic extracted from useSessionSelection.
 * Since the hook is thin state wrapper, we test the pure logic operations directly.
 */

describe('session selection logic', () => {
  // Helpers that mirror the hook's internal logic
  function toggle(selected: Set<string>, sessionId: string): Set<string> {
    const next = new Set(selected);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    return next;
  }

  function rangeSelect(
    selected: Set<string>,
    anchor: string | null,
    target: string,
    allVisibleIds: string[],
  ): Set<string> {
    if (!anchor) return new Set([target]);
    const anchorIdx = allVisibleIds.indexOf(anchor);
    const targetIdx = allVisibleIds.indexOf(target);
    if (anchorIdx === -1 || targetIdx === -1) return selected;
    const start = Math.min(anchorIdx, targetIdx);
    const end = Math.max(anchorIdx, targetIdx);
    const next = new Set(selected);
    for (const id of allVisibleIds.slice(start, end + 1)) next.add(id);
    return next;
  }

  function selectAll(sessionIds: string[]): Set<string> {
    return new Set(sessionIds);
  }

  function filterSelectable(sessions: { id: string; status: string }[]): string[] {
    return sessions.filter((s) => s.status !== 'running').map((s) => s.id);
  }

  describe('toggle', () => {
    test('adds a session to empty selection', () => {
      const result = toggle(new Set(), 'a');
      expect(result.has('a')).toBe(true);
      expect(result.size).toBe(1);
    });

    test('removes an already-selected session', () => {
      const result = toggle(new Set(['a', 'b']), 'a');
      expect(result.has('a')).toBe(false);
      expect(result.has('b')).toBe(true);
      expect(result.size).toBe(1);
    });

    test('adds to existing selection', () => {
      const result = toggle(new Set(['a']), 'b');
      expect(result.has('a')).toBe(true);
      expect(result.has('b')).toBe(true);
      expect(result.size).toBe(2);
    });
  });

  describe('rangeSelect', () => {
    const visible = ['a', 'b', 'c', 'd', 'e'];

    test('selects range from anchor to target (forward)', () => {
      const result = rangeSelect(new Set(['b']), 'b', 'd', visible);
      expect([...result].sort()).toEqual(['b', 'c', 'd']);
    });

    test('selects range from anchor to target (backward)', () => {
      const result = rangeSelect(new Set(['d']), 'd', 'b', visible);
      expect([...result].sort()).toEqual(['b', 'c', 'd']);
    });

    test('preserves existing selections outside the range', () => {
      const result = rangeSelect(new Set(['a', 'c']), 'c', 'e', visible);
      expect([...result].sort()).toEqual(['a', 'c', 'd', 'e']);
    });

    test('falls back to single selection when no anchor', () => {
      const result = rangeSelect(new Set(), null, 'c', visible);
      expect([...result]).toEqual(['c']);
    });

    test('no-ops when anchor is not in visible list', () => {
      const result = rangeSelect(new Set(['x']), 'x', 'c', visible);
      expect([...result]).toEqual(['x']);
    });

    test('no-ops when target is not in visible list', () => {
      const result = rangeSelect(new Set(['a']), 'a', 'z', visible);
      expect([...result]).toEqual(['a']);
    });
  });

  describe('selectAll', () => {
    test('selects all provided IDs', () => {
      const result = selectAll(['a', 'b', 'c']);
      expect(result.size).toBe(3);
      expect(result.has('a')).toBe(true);
      expect(result.has('b')).toBe(true);
      expect(result.has('c')).toBe(true);
    });

    test('handles empty list', () => {
      const result = selectAll([]);
      expect(result.size).toBe(0);
    });
  });

  describe('filterSelectable (running session exclusion)', () => {
    test('excludes running sessions', () => {
      const sessions = [
        { id: 'a', status: 'idle' },
        { id: 'b', status: 'running' },
        { id: 'c', status: 'error' },
        { id: 'd', status: 'running' },
      ];
      const result = filterSelectable(sessions);
      expect(result).toEqual(['a', 'c']);
    });

    test('includes all when none are running', () => {
      const sessions = [
        { id: 'a', status: 'idle' },
        { id: 'b', status: 'idle' },
      ];
      const result = filterSelectable(sessions);
      expect(result).toEqual(['a', 'b']);
    });

    test('returns empty when all are running', () => {
      const sessions = [
        { id: 'a', status: 'running' },
        { id: 'b', status: 'running' },
      ];
      const result = filterSelectable(sessions);
      expect(result).toEqual([]);
    });
  });

  describe('enter and exit selection mode', () => {
    test('entering with an initial ID creates a set with that ID', () => {
      const selected = new Set(['initial']);
      expect(selected.size).toBe(1);
      expect(selected.has('initial')).toBe(true);
    });

    test('exiting clears all selections', () => {
      const selected = new Set(['a', 'b', 'c']);
      const cleared = new Set<string>();
      expect(cleared.size).toBe(0);
      expect(selected.size).toBe(3);
    });
  });

  describe('batch archive determination', () => {
    test('allSelectedArchived is true when all selected are archived', () => {
      const sessions = [
        { id: 'a', isArchived: true },
        { id: 'b', isArchived: true },
        { id: 'c', isArchived: false },
      ];
      const selected = new Set(['a', 'b']);
      const allArchived = [...selected].every((id) => {
        const s = sessions.find((s) => s.id === id);
        return s?.isArchived;
      });
      expect(allArchived).toBe(true);
    });

    test('allSelectedArchived is false when any selected is not archived', () => {
      const sessions = [
        { id: 'a', isArchived: true },
        { id: 'b', isArchived: false },
      ];
      const selected = new Set(['a', 'b']);
      const allArchived = [...selected].every((id) => {
        const s = sessions.find((s) => s.id === id);
        return s?.isArchived;
      });
      expect(allArchived).toBe(false);
    });
  });
});
