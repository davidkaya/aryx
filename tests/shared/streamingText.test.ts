import { describe, expect, test } from 'bun:test';

import { mergeStreamingText } from '@shared/utils/streamingText';

describe('streaming text merge', () => {
  test('appends plain deltas', () => {
    expect(mergeStreamingText('I am', ' going')).toBe('I am going');
  });

  test('replaces with a growing snapshot when the incoming text already contains the current text', () => {
    expect(mergeStreamingText('I am', 'I am going')).toBe('I am going');
  });

  test('preserves the current text when the incoming update is a duplicate subset', () => {
    expect(mergeStreamingText('I am going', 'going')).toBe('I am going');
  });

  test('uses overlap matching to avoid duplicated joins', () => {
    expect(mergeStreamingText('Hello wor', 'world')).toBe('Hello world');
  });

  test('replaces with a revised snapshot when the updates share most of the same tokens', () => {
    const current = 'I mirror the existing button pattern and add brief toggle docs.';
    const incoming = 'I found the standalone component pattern and I am updating toggle docs next.';

    expect(mergeStreamingText(current, incoming)).toBe(incoming);
  });

  test('inserts whitespace when snapshot-like updates would otherwise glue words together', () => {
    expect(mergeStreamingText('How about', 'The **Ashen Crown** feels')).toBe(
      'How about The **Ashen Crown** feels',
    );
    expect(mergeStreamingText('The **Ashen Crown** feels', 'classic and timeless.')).toBe(
      'The **Ashen Crown** feels classic and timeless.',
    );
  });

  test('inserts a newline before streamed markdown block markers', () => {
    expect(mergeStreamingText('If you want, I can also give you', '- darker titles')).toBe(
      'If you want, I can also give you\n- darker titles',
    );
  });
});
