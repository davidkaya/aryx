import { describe, expect, test } from 'bun:test';

import {
  formatToolCallSummary,
  formatToolArgumentValue,
  getDisplayableArguments,
} from '@renderer/lib/toolCallSummary';

describe('formatToolCallSummary', () => {
  test('returns undefined when toolName is missing', () => {
    expect(formatToolCallSummary(undefined, { command: 'ls' })).toBeUndefined();
  });

  test('returns undefined when toolArguments is missing', () => {
    expect(formatToolCallSummary('powershell', undefined)).toBeUndefined();
  });

  test('returns undefined when toolArguments is empty', () => {
    expect(formatToolCallSummary('powershell', {})).toBeUndefined();
  });

  test('extracts command for powershell', () => {
    expect(formatToolCallSummary('powershell', { command: 'git status' })).toBe('git status');
  });

  test('truncates long powershell commands', () => {
    const longCommand = 'a'.repeat(100);
    const result = formatToolCallSummary('powershell', { command: longCommand });
    expect(result!.length).toBeLessThanOrEqual(81); // 80 + ellipsis
    expect(result!.endsWith('…')).toBe(true);
  });

  test('extracts path for view tool', () => {
    expect(formatToolCallSummary('view', { path: '/src/index.ts' })).toBe('/src/index.ts');
  });

  test('includes view range when present', () => {
    expect(formatToolCallSummary('view', { path: '/src/index.ts', view_range: [10, 25] }))
      .toBe('/src/index.ts:10-25');
  });

  test('supports viewRange camelCase variant', () => {
    expect(formatToolCallSummary('view', { path: '/src/index.ts', viewRange: [1, 50] }))
      .toBe('/src/index.ts:1-50');
  });

  test('extracts path for edit tool', () => {
    expect(formatToolCallSummary('edit', { path: '/src/utils.ts', old_str: 'foo' }))
      .toBe('/src/utils.ts');
  });

  test('extracts path for create tool', () => {
    expect(formatToolCallSummary('create', { path: '/new-file.ts', file_text: 'content' }))
      .toBe('/new-file.ts');
  });

  test('extracts pattern for grep', () => {
    expect(formatToolCallSummary('grep', { pattern: 'TODO', path: '/src' })).toBe('TODO');
  });

  test('extracts pattern for glob', () => {
    expect(formatToolCallSummary('glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  test('extracts operation and file for lsp', () => {
    expect(formatToolCallSummary('lsp', { operation: 'goToDefinition', file: '/src/app.ts' }))
      .toBe('goToDefinition /src/app.ts');
  });

  test('extracts just operation when file is missing for lsp', () => {
    expect(formatToolCallSummary('lsp', { operation: 'workspaceSymbol', query: 'Foo' }))
      .toBe('workspaceSymbol');
  });

  test('extracts url for web_fetch', () => {
    expect(formatToolCallSummary('web_fetch', { url: 'https://example.com' }))
      .toBe('https://example.com');
  });

  test('extracts description for sql', () => {
    expect(formatToolCallSummary('sql', { description: 'Insert todos', query: 'INSERT ...' }))
      .toBe('Insert todos');
  });

  test('extracts description for task', () => {
    expect(formatToolCallSummary('task', { description: 'Run tests' })).toBe('Run tests');
  });

  test('extracts question for ask_user', () => {
    expect(formatToolCallSummary('ask_user', { question: 'Which database?' })).toBe('Which database?');
  });

  test('extracts intent for report_intent', () => {
    expect(formatToolCallSummary('report_intent', { intent: 'Exploring codebase' }))
      .toBe('Exploring codebase');
  });

  test('summarizes github tools with query', () => {
    expect(formatToolCallSummary('github-search_code', { query: 'FunctionCallContent' }))
      .toBe('FunctionCallContent');
  });

  test('summarizes github tools with owner/repo', () => {
    expect(formatToolCallSummary('github-get_file_contents', { owner: 'octocat', repo: 'hello-world' }))
      .toBe('octocat/hello-world');
  });

  test('falls back to first string value for unknown tools', () => {
    expect(formatToolCallSummary('unknown_tool', { target: 'production', count: 42 }))
      .toBe('production');
  });

  test('skips [truncated] values in fallback', () => {
    expect(formatToolCallSummary('unknown_tool', { data: '[truncated]', label: 'test' }))
      .toBe('test');
  });

  test('uses first line only for multiline commands', () => {
    const result = formatToolCallSummary('powershell', { command: 'echo hello\necho world' });
    expect(result).toBe('echo hello');
  });
});

describe('formatToolArgumentValue', () => {
  test('formats string values directly', () => {
    expect(formatToolArgumentValue('hello')).toBe('hello');
  });

  test('formats numbers', () => {
    expect(formatToolArgumentValue(42)).toBe('42');
  });

  test('formats booleans', () => {
    expect(formatToolArgumentValue(true)).toBe('true');
  });

  test('formats null as empty string', () => {
    expect(formatToolArgumentValue(null)).toBe('');
  });

  test('formats objects as pretty JSON', () => {
    const result = formatToolArgumentValue({ a: 1, b: 'two' });
    expect(result).toContain('"a": 1');
    expect(result).toContain('"b": "two"');
  });

  test('formats arrays as pretty JSON', () => {
    const result = formatToolArgumentValue([1, 2, 3]);
    expect(result).toContain('1');
    expect(result).toContain('3');
  });
});

describe('getDisplayableArguments', () => {
  test('returns empty array when toolArguments is undefined', () => {
    expect(getDisplayableArguments(undefined)).toEqual([]);
  });

  test('filters out null and undefined values', () => {
    const result = getDisplayableArguments({ a: 'value', b: null, c: undefined, d: 'ok' });
    expect(result).toEqual([['a', 'value'], ['d', 'ok']]);
  });

  test('filters out empty string values', () => {
    const result = getDisplayableArguments({ a: '', b: 'value' });
    expect(result).toEqual([['b', 'value']]);
  });

  test('filters out description key', () => {
    const result = getDisplayableArguments({ description: 'Insert todos', query: 'INSERT ...' });
    expect(result).toEqual([['query', 'INSERT ...']]);
  });
});
