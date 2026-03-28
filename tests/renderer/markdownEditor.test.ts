import { describe, expect, test } from 'bun:test';
import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import {
  $createCodeNode,
  $createCodeHighlightNode,
  CodeNode,
} from '@lexical/code';
import {
  $createLineBreakNode,
  $createRangeSelection,
  $getRoot,
  $setSelection,
} from 'lexical';

import {
  findCodeNodeSelectionPoint,
  getCodeNodeAbsoluteOffset,
  inspectMarkdownPaste,
  markdownEditorNamespace,
  markdownEditorNodes,
  markdownEditorTransformers,
  restoreCodeNodeSelection,
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

/* ── Code-node selection helpers ──────────────────────── */

function createTestEditor() {
  return createHeadlessEditor({
    namespace: markdownEditorNamespace,
    nodes: [...markdownEditorNodes],
    onError(error) {
      throw error;
    },
  });
}

describe('code-node selection helpers', () => {
  test('findCodeNodeSelectionPoint targets CodeNode (not LineBreakNode) for linebreak-only content', () => {
    const editor = createTestEditor();

    editor.update(() => {
      const codeNode = $createCodeNode();
      codeNode.append($createLineBreakNode());
      $getRoot().clear().append(codeNode);

      // target=0 → before the LineBreakNode
      const before = findCodeNodeSelectionPoint(codeNode, 0);
      expect(before.key).toBe(codeNode.getKey());
      expect(before.offset).toBe(0);
      expect(before.type).toBe('element');

      // target=1 → after the LineBreakNode (fallback)
      const after = findCodeNodeSelectionPoint(codeNode, 1);
      expect(after.key).toBe(codeNode.getKey());
      expect(after.offset).toBe(1);
      expect(after.type).toBe('element');
    }, { discrete: true });
  });

  test('findCodeNodeSelectionPoint targets text nodes correctly', () => {
    const editor = createTestEditor();

    editor.update(() => {
      const codeNode = $createCodeNode();
      codeNode.append($createCodeHighlightNode('hello'));
      codeNode.append($createLineBreakNode());
      codeNode.append($createCodeHighlightNode('world'));
      $getRoot().clear().append(codeNode);

      // target=3 → inside "hello"
      const mid = findCodeNodeSelectionPoint(codeNode, 3);
      expect(mid.key).toBe(codeNode.getChildren()[0].getKey());
      expect(mid.offset).toBe(3);
      expect(mid.type).toBe('text');

      // target=5 → end of "hello" (text boundary)
      const endHello = findCodeNodeSelectionPoint(codeNode, 5);
      expect(endHello.key).toBe(codeNode.getChildren()[0].getKey());
      expect(endHello.offset).toBe(5);
      expect(endHello.type).toBe('text');

      // target=6 → after the LineBreakNode → start of "world"
      const startWorld = findCodeNodeSelectionPoint(codeNode, 6);
      expect(startWorld.key).toBe(codeNode.getChildren()[2].getKey());
      expect(startWorld.offset).toBe(0);
      expect(startWorld.type).toBe('text');
    }, { discrete: true });
  });

  test('findCodeNodeSelectionPoint handles empty CodeNode', () => {
    const editor = createTestEditor();

    editor.update(() => {
      const codeNode = $createCodeNode();
      $getRoot().clear().append(codeNode);

      const point = findCodeNodeSelectionPoint(codeNode, 0);
      expect(point.key).toBe(codeNode.getKey());
      expect(point.offset).toBe(0);
      expect(point.type).toBe('element');
    }, { discrete: true });
  });

  test('restoreCodeNodeSelection does not throw on linebreak-only CodeNode', () => {
    const editor = createTestEditor();

    editor.update(() => {
      const codeNode = $createCodeNode();
      codeNode.append($createLineBreakNode());
      $getRoot().clear().append(codeNode);

      // Create a valid selection so restoreCodeNodeSelection has one to update
      const sel = $createRangeSelection();
      sel.anchor.set(codeNode.getKey(), 0, 'element');
      sel.focus.set(codeNode.getKey(), 0, 'element');
      $setSelection(sel);

      // This would throw before the fix because findPoint returned a point
      // targeting the LineBreakNode with type 'element'
      expect(() => restoreCodeNodeSelection(codeNode, 1, 1)).not.toThrow();
    }, { discrete: true });
  });

  test('getCodeNodeAbsoluteOffset computes character offsets correctly', () => {
    const editor = createTestEditor();

    editor.update(() => {
      const codeNode = $createCodeNode();
      const hello = $createCodeHighlightNode('hello');
      const lb = $createLineBreakNode();
      const world = $createCodeHighlightNode('world');
      codeNode.append(hello, lb, world);
      $getRoot().clear().append(codeNode);

      expect(getCodeNodeAbsoluteOffset(codeNode, { key: hello.getKey(), offset: 0 })).toBe(0);
      expect(getCodeNodeAbsoluteOffset(codeNode, { key: hello.getKey(), offset: 3 })).toBe(3);
      expect(getCodeNodeAbsoluteOffset(codeNode, { key: lb.getKey(), offset: 0 })).toBe(5);
      expect(getCodeNodeAbsoluteOffset(codeNode, { key: world.getKey(), offset: 2 })).toBe(8);
    }, { discrete: true });
  });
});
