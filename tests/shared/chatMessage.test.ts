import { describe, expect, test } from 'bun:test';

import {
  hasMeaningfulChatMessageContent,
  normalizeChatMessageLineEndings,
  prepareChatMessageContent,
} from '@shared/utils/chatMessage';

describe('chat message helpers', () => {
  test('normalizes Windows line endings without trimming meaningful markdown', () => {
    expect(
      prepareChatMessageContent('```ts\r\n  const answer = 42;\r\n```\r\n'),
    ).toBe('```ts\n  const answer = 42;\n```\n');
  });

  test('treats whitespace-only input as empty', () => {
    expect(hasMeaningfulChatMessageContent(' \r\n\t ')).toBe(false);
    expect(prepareChatMessageContent(' \r\n\t ')).toBeUndefined();
  });

  test('normalizes mixed newline sequences consistently', () => {
    expect(normalizeChatMessageLineEndings('line 1\r\nline 2\rline 3')).toBe(
      'line 1\nline 2\nline 3',
    );
  });
});
