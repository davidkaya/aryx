import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { type Transformer, TRANSFORMERS } from '@lexical/markdown';
import { ListItemNode, ListNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { type Klass, type LexicalNode } from 'lexical';

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

export const markdownEditorNamespace = 'eryx-markdown-composer';

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
