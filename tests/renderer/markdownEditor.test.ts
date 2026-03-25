import { describe, expect, test } from 'bun:test';
import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';

import {
  inspectMarkdownPaste,
  markdownEditorNamespace,
  markdownEditorNodes,
  markdownEditorTransformers,
} from '@renderer/lib/markdownEditor';

function roundTripMarkdown(markdown: string): string {
  const editor = createHeadlessEditor({
    namespace: markdownEditorNamespace,
    nodes: [...markdownEditorNodes],
    onError(error) {
      throw error;
    },
  });

  editor.update(() => {
    $convertFromMarkdownString(markdown, [...markdownEditorTransformers], undefined, true, false);
  }, { discrete: true });

  let result = '';
  editor.getEditorState().read(() => {
    result = $convertToMarkdownString([...markdownEditorTransformers], undefined, true);
  });

  return result;
}

describe('markdown editor contract', () => {
  test('round-trips markdown structures with the chosen node set', () => {
    const markdown = [
      '# Release notes',
      '',
      '- item one',
      '- item two',
      '',
      '> keep the markdown contract stable',
      '',
      '```ts',
      'const answer = 42;',
      '```',
      '',
      '[Docs](https://example.com)',
    ].join('\n');

    const roundTripped = roundTripMarkdown(markdown);

    expect(roundTripped).toContain('# Release notes');
    expect(roundTripped).toContain('- item one');
    expect(roundTripped).toContain('```ts');
    expect(roundTripped).toContain('[Docs](https://example.com)');
  });

  test('classifies fenced code as markdown paste', () => {
    expect(inspectMarkdownPaste('```ts\nconst answer = 42;\n```')).toEqual({
      normalizedText: '```ts\nconst answer = 42;\n```',
      shouldImportMarkdown: true,
      reason: 'fenced-code',
    });
  });

  test('keeps plain prose on the plain-text path', () => {
    expect(inspectMarkdownPaste('Just a normal sentence about the release plan.')).toEqual({
      normalizedText: 'Just a normal sentence about the release plan.',
      shouldImportMarkdown: false,
      reason: 'plain-text',
    });
  });
});
