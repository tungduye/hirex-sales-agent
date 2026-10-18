import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMentions } from '../src/modules/inbox/core/mentions.ts';

test('known member names after @ are mentions; longest name wins', () => {
  const parts = splitMentions('@Hoàng Toản @Tùng Phát Triển ưu tiên họp nhé', ['Hoàng Toản', 'Tùng', 'Tùng Phát Triển'], []);
  assert.deepEqual(parts.filter((p) => p.mention).map((p) => p.text), ['@Hoàng Toản', '@Tùng Phát Triển']);
  assert.equal(parts.map((p) => p.text).join(''), '@Hoàng Toản @Tùng Phát Triển ưu tiên họp nhé');
});

test('mentions of my own nick and @All are marked mine; unknown names and emails stay plain', () => {
  const parts = splitMentions('@All họp, @Stella Nguyen xem giúp, @người lạ, mail a@b.com', ['Stella Nguyen'], ['Stella Nguyen']);
  assert.deepEqual(parts.filter((p) => p.mention).map((p) => [p.text, p.mine]), [['@All', true], ['@Stella Nguyen', true]]);
  assert.ok(parts.some((p) => !p.mention && p.text.includes('@người lạ')));
});

test('text without mentions is one plain part', () => {
  assert.deepEqual(splitMentions('Chào cả nhà', ['Lan'], []), [{ text: 'Chào cả nhà', mention: false, mine: false }]);
});

test('a name must end at a word boundary', () => {
  assert.equal(splitMentions('@Allen ơi', ['Lan'], []).some((p) => p.mention), false);
  assert.equal(splitMentions('@Lan, ơi', ['Lan'], []).filter((p) => p.mention).length, 1);
});
