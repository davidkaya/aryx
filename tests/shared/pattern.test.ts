import { describe, expect, test } from 'bun:test';

import { createBuiltinPatterns, validatePatternDefinition } from '@shared/domain/pattern';

describe('pattern validation', () => {
  test('builtin patterns are valid except explicitly unavailable modes', () => {
    const patterns = createBuiltinPatterns('2026-03-22T00:00:00.000Z');

    const validPatterns = patterns.filter((pattern) => pattern.availability !== 'unavailable');

    for (const pattern of validPatterns) {
      expect(validatePatternDefinition(pattern)).toEqual([]);
    }
  });

  test('magentic pattern is marked unavailable', () => {
    const magentic = createBuiltinPatterns('2026-03-22T00:00:00.000Z').find(
      (pattern) => pattern.mode === 'magentic',
    );

    expect(magentic).toBeDefined();
    expect(validatePatternDefinition(magentic!)[0]?.message).toContain('unsupported');
  });
});
