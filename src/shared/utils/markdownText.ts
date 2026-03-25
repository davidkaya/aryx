import { normalizeChatMessageLineEndings } from '@shared/utils/chatMessage';

const fencedCodeBlockPattern = /```[^\n]*\n([\s\S]*?)```/g;
const inlineCodePattern = /`([^`]+)`/g;
const imagePattern = /!\[([^\]]*)]\([^)]+\)/g;
const linkPattern = /\[([^\]]+)]\([^)]+\)/g;
const autoLinkPattern = /<((?:https?:\/\/|mailto:)[^>]+)>/g;
const headingPattern = /^\s{0,3}#{1,6}\s+/gm;
const blockquotePattern = /^\s{0,3}>\s?/gm;
const listPattern = /^\s{0,3}(?:[-*+]|\d+\.)\s+/gm;
const checklistPattern = /^\s*\[[ xX]\]\s+/gm;
const setextHeadingPattern = /^[=-]{2,}\s*$/gm;
const thematicBreakPattern = /^[ \t]{0,3}(?:[-*_][ \t]*){3,}$/gm;
const tableSeparatorPattern = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/gm;
const emphasisPattern = /(\*\*|__|~~|\*|_)/g;
const markdownEscapePattern = /\\([\\`*_{}\[\]()#+\-.!>])/g;

export function extractPlainTextFromMarkdown(markdown: string): string {
  const normalized = normalizeChatMessageLineEndings(markdown);

  const plain = normalized
    .replace(fencedCodeBlockPattern, '$1')
    .replace(inlineCodePattern, '$1')
    .replace(imagePattern, '$1')
    .replace(linkPattern, '$1')
    .replace(autoLinkPattern, '$1')
    .replace(headingPattern, '')
    .replace(blockquotePattern, '')
    .replace(listPattern, '')
    .replace(checklistPattern, '')
    .replace(setextHeadingPattern, ' ')
    .replace(thematicBreakPattern, ' ')
    .replace(tableSeparatorPattern, ' ')
    .replace(/\|/g, ' ')
    .replace(emphasisPattern, '')
    .replace(markdownEscapePattern, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return plain;
}

export function buildMarkdownExcerpt(markdown: string | undefined, maxLength = 80): string | undefined {
  if (!markdown) {
    return undefined;
  }

  const plainText = extractPlainTextFromMarkdown(markdown);
  if (!plainText) {
    return undefined;
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trimEnd()}…`;
}
