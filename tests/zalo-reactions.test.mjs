import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { planReactionChanges, selectReactedMessages, summarizeReactions } from '../scripts/lib/zalo-reactions.mjs';
import { QUICK_REACTIONS, isQuickReactionIcon, toMessageReactions, withMyReaction } from '../src/modules/channels/core/zalo-reactions.ts';

const raw = JSON.stringify({ total: 3, lastReact: '❤️', emoji: { '❤️': { total: 2, users: { '716': 1, '99': 1 } }, '👍': { total: 1, users: { '55': 1 } }, '': { total: 4 }, 'x': { total: 0 } } });

test('Deplao reactions become counts, and the nick\'s own ones are marked', () => {
  assert.deepEqual(summarizeReactions(raw, '716'), { summary: [{ emoji: '❤️', count: 2 }, { emoji: '👍', count: 1 }], mine: ['❤️'] });
  assert.equal(summarizeReactions('not json', '716'), null);
  assert.equal(summarizeReactions('{"total":0,"emoji":{}}', '716'), null);
});

test('only changed reactions are written; vanished ones are cleared', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("create table messages (msg_id text, owner_zalo_id text, channel text, timestamp integer, reactions text)");
  const insert = db.prepare('insert into messages values (?,?,?,?,?)');
  insert.run('1', '716', 'zalo', 10, raw); insert.run('2', '716', 'zalo', 10, '{}'); insert.run('3', '999', 'zalo', 10, raw); insert.run('4', '716', 'zalo', 10, null);
  const first = planReactionChanges(selectReactedMessages(db, '716', 0), '716', {});
  assert.deepEqual(first.upserts.map((row) => row.msgId), ['1']);
  const again = planReactionChanges(selectReactedMessages(db, '716', 0), '716', first.next);
  assert.deepEqual([again.upserts, again.removed], [[], []]);
  const later = planReactionChanges([], '716', first.next);
  assert.deepEqual(later.removed, ['1']);
});

test('the inbox shows reactions and adds the nick\'s own right away', () => {
  const shown = toMessageReactions([{ emoji: '❤️', count: 2 }, { emoji: '👍', count: 1 }, { bad: true }], ['👍']);
  assert.deepEqual(shown, [{ emoji: '❤️', count: 2, mine: false }, { emoji: '👍', count: 1, mine: true }]);
  assert.deepEqual(withMyReaction(shown, '❤️')[0], { emoji: '❤️', count: 3, mine: true });
  assert.deepEqual(withMyReaction([], '😆'), [{ emoji: '😆', count: 1, mine: true }]);
  assert.deepEqual(QUICK_REACTIONS.map((item) => item.icon), ['HEART', 'LIKE', 'HAHA', 'WOW', 'CRY', 'ANGRY']);
  assert.equal(isQuickReactionIcon('SHIT'), false);
});

test('reacting needs the reply right and access to the nick, and only targets a message of that conversation', () => {
  const source = readFileSync(new URL('../src/modules/channels/server/reaction-actions.ts', import.meta.url), 'utf8');
  assert.match(source, /hasPermission\("inbox\.reply"\)/u);
  assert.match(source, /canAccessChannelAccount\(conversation\.channel_account_id\)/u);
  assert.match(source, /eq\("conversation_id", conversation\.id\)/u);
  const supervisor = readFileSync(new URL('../scripts/deplao-realtime-supervisor.mjs', import.meta.url), 'utf8');
  assert.match(supervisor, /schedule\("reaction-sync", "sync-zalo-reactions\.mjs"/u);
});
