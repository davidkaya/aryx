import { describe, expect, test } from 'bun:test';

import { buildMarkdownExcerpt, extractPlainTextFromMarkdown } from '@shared/utils/markdownText';

describe('markdown text helpers', () => {
  test('extracts readable text from common markdown syntax', () => {
    expect(
      extractPlainTextFromMarkdown('# Title\n\n**Bold** [Docs](https://example.com) and `code`.'),
    ).toBe('Title Bold Docs and code.');
  });

  test('turns fenced code blocks into readable excerpts', () => {
    expect(buildMarkdownExcerpt('```ts\nconst answer = 42;\n```', 48)).toBe('const answer = 42;');
  });

  test('truncates after stripping markdown syntax', () => {
    expect(buildMarkdownExcerpt('**Alpha** beta gamma delta epsilon zeta eta theta', 18)).toBe(
      'Alpha beta gamma d…',
    );
  });
});
