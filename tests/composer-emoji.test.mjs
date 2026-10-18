import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { insertAt } from '../src/modules/channels/core/text-insert.ts';

test('emoji go in at the caret or replace the selection', () => {
  assert.deepEqual(insertAt('Chào em', '😊', 4, 4), { text: 'Chào😊 em', caret: 6 });
  assert.deepEqual(insertAt('Chào em', '👍', 5, 7), { text: 'Chào 👍', caret: 7 });
  assert.deepEqual(insertAt('', '🎉', 3, 9), { text: '🎉', caret: 2 });
});

test('the composer offers the emoji picker for every channel', () => {
  const composer = readFileSync(new URL('../src/modules/channels/components/conversation-composer.tsx', import.meta.url), 'utf8');
  assert.match(composer, /<EmojiPicker onPick=\{insertEmoji\} disabled=\{drafting\}\/>/);
});
