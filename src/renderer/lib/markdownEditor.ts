import { $isCodeHighlightNode, CodeHighlightNode, CodeNode } from '@lexical/code';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { type Transformer, TRANSFORMERS } from '@lexical/markdown';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import {
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type Klass,
  type LexicalNode,
} from 'lexical';

import { normalizeChatMessageLineEndings } from '@shared/utils/chatMessage';

const fencedCodePattern = /(^|\n)```/;
const blockMarkdownPattern = /(^|\n)\s{0,3}(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s|\[[ xX]\]\s)/;
const tablePattern = /(^|\n)\|.*\|\s*\n\|?[\s:-]+\|/;
const linkPattern = /\[([^\]]+)]\(([^)]+)\)/;
const inlineFormattingPattern =
  /(?:`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|_[^_\n]+_)/;

export type MarkdownPasteReason =
  | 'fenced-code'
  | 'block-structure'
  | 'table'
  | 'link'
  | 'inline-format'
  | 'plain-text';

export interface MarkdownPasteInspection {
  normalizedText: string;
  shouldImportMarkdown: boolean;
  reason: MarkdownPasteReason;
}

export const markdownEditorNamespace = 'aryx-markdown-composer';

export const markdownEditorNodes: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  CodeHighlightNode,
];

export const markdownEditorTransformers: ReadonlyArray<Transformer> = TRANSFORMERS;

export function inspectMarkdownPaste(text: string): MarkdownPasteInspection {
  const normalizedText = normalizeChatMessageLineEndings(text);

  if (fencedCodePattern.test(normalizedText)) {
    return {
      normalizedText,
      shouldImportMarkdown: true,
      reason: 'fenced-code',
    };
  }

  if (blockMarkdownPattern.test(normalizedText)) {
    return {
      normalizedText,
      shouldImportMarkdown: true,
      reason: 'block-structure',
    };
  }

  if (tablePattern.test(normalizedText)) {
    return {
      normalizedText,
      shouldImportMarkdown: true,
      reason: 'table',
    };
  }

  if (linkPattern.test(normalizedText)) {
    return {
      normalizedText,
      shouldImportMarkdown: true,
      reason: 'link',
    };
  }

  if (inlineFormattingPattern.test(normalizedText)) {
    return {
      normalizedText,
      shouldImportMarkdown: true,
      reason: 'inline-format',
    };
  }

  return {
    normalizedText,
    shouldImportMarkdown: false,
    reason: 'plain-text',
  };
}

export function shouldImportMarkdownPaste(text: string): boolean {
  return inspectMarkdownPaste(text).shouldImportMarkdown;
}

/* ── Code-node selection helpers ──────────────────────── */

/**
 * Returns the absolute character offset of a selection point within a CodeNode.
 * LineBreakNodes count as 1 character; all other children use their text content size.
 */
export function getCodeNodeAbsoluteOffset(
  codeNode: CodeNode,
  point: { key: string; offset: number },
): number {
  let offset = 0;
  for (const child of codeNode.getChildren()) {
    if (child.getKey() === point.key) return offset + point.offset;
    offset += $isLineBreakNode(child) ? 1 : child.getTextContentSize();
  }
  return offset;
}

/**
 * Converts an absolute character offset within a CodeNode into a valid Lexical
 * selection point (node key, local offset, and point type).
 *
 * The returned point always targets either a text-like child (`type: 'text'`)
 * or the parent CodeNode itself (`type: 'element'`).  It never targets a
 * LineBreakNode directly — doing so would crash Lexical because LineBreakNode
 * is not an ElementNode.
 */
export function findCodeNodeSelectionPoint(
  codeNode: CodeNode,
  target: number,
): { key: string; offset: number; type: 'text' | 'element' } {
  const children = codeNode.getChildren();
  let offset = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const size = $isLineBreakNode(child) ? 1 : child.getTextContentSize();
    if (offset + size > target || (offset + size === target && $isTextNode(child))) {
      if ($isTextNode(child) || $isCodeHighlightNode(child)) {
        return { key: child.getKey(), offset: target - offset, type: 'text' as const };
      }
      // Non-text child (e.g. LineBreakNode): target the parent CodeNode at this child index
      return { key: codeNode.getKey(), offset: i, type: 'element' as const };
    }
    offset += size;
  }
  const last = children.length > 0 ? children[children.length - 1] : undefined;
  if (last && ($isTextNode(last) || $isCodeHighlightNode(last))) {
    return { key: last.getKey(), offset: last.getTextContentSize(), type: 'text' as const };
  }
  return { key: codeNode.getKey(), offset: children.length, type: 'element' as const };
}

/**
 * Restores a range selection within a CodeNode from absolute character offsets.
 * Must be called inside an editor update or read context.
 */
export function restoreCodeNodeSelection(
  codeNode: CodeNode,
  anchorOff: number,
  focusOff: number,
): void {
  const anchor = findCodeNodeSelectionPoint(codeNode, anchorOff);
  const focus = findCodeNodeSelectionPoint(codeNode, focusOff);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.anchor.set(anchor.key, anchor.offset, anchor.type);
    selection.focus.set(focus.key, focus.offset, focus.type);
  }
}
