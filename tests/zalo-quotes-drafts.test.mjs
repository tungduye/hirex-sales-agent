import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { mapQuote, selectQuotedMessages } from '../scripts/lib/zalo-reactions.mjs';
import { draftKey, listDrafts, readDraft, writeDraft } from '../src/modules/channels/core/composer-drafts.ts';

function memoryStore() {
  const map = new Map();
  return { getItem: (k) => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k),
    get length() { return map.size; }, key: (i) => [...map.keys()][i] ?? null };
}

test('a draft is kept per conversation, comes back, expires, and is removed when emptied', () => {
  const store = memoryStore(), now = 1_800_000_000_000;
  writeDraft(store, 'c1', 'Chào @Lan', [{ uid: '11', name: 'Lan' }], now);
  writeDraft(store, 'c2', '   ', [], now);
  assert.deepEqual(readDraft(store, 'c1', now + 1000), { text: 'Chào @Lan', picks: [{ uid: '11', name: 'Lan' }], savedAt: now });
  assert.equal(readDraft(store, 'c2', now), null);
  assert.deepEqual([...listDrafts(store, now)], [['c1', 'Chào @Lan']]);
  assert.equal(readDraft(store, 'c1', now + 15 * 86_400_000), null);
  assert.equal(store.getItem(draftKey('c1')), null);
  writeDraft(store, 'c3', 'x', [], now); writeDraft(store, 'c3', '', [], now);
  assert.equal(store.getItem(draftKey('c3')), null);
  assert.equal(readDraft(null, 'c1', now), null);
});

test('Deplao reply-quotes become the quoted line shown above a reply', () => {
  assert.deepEqual(mapQuote({ msgId: '9', quote_data: JSON.stringify({ msg: 'Anh  ơi\\n gửi JD', fromD: 'Lan', msgType: 'webchat', msgId: '8' }) }),
    { msgId: '9', quotedMessageId: '8', quotedText: 'Anh ơi\\n gửi JD', quotedSender: 'Lan' });
  assert.equal(mapQuote({ msgId: '9', quote_data: JSON.stringify({ msg: '', fromD: '', msgType: 'chat.photo', msgId: 'x' }) }).quotedText, '[Hình ảnh]');
  assert.equal(mapQuote({ msgId: '9', quote_data: 'not json' }), null);
  const db = new DatabaseSync(':memory:');
  db.exec("create table messages (id integer primary key, msg_id text, owner_zalo_id text, channel text, quote_data text)");
  db.exec(`insert into messages(msg_id,owner_zalo_id,channel,quote_data) values ('1','716','zalo',null),('2','716','zalo','{"msg":"a"}'),('3','999','zalo','{"msg":"b"}'),('4','716','zalo','{"msg":"c"}')`);
  assert.deepEqual(selectQuotedMessages(db, '716', 0).map((row) => row.msgId), ['2', '4']);
  assert.deepEqual(selectQuotedMessages(db, '716', 2).map((row) => row.msgId), ['4']);
});

test('a quoted reply is checked against the conversation and travels only with a person\'s Zalo reply', () => {
  const actions = readFileSync(new URL('../src/modules/channels/server/channel-actions.ts', import.meta.url), 'utf8');
  assert.match(actions, /formData\.get\("quoteMessageId"\)/u);
  assert.match(actions, /eq\("conversation_id", parsed\.data\.conversationId\)\.eq\("provider_message_id", rawQuote\)/u);
  const executor = readFileSync(new URL('../src/modules/channels/server/execute-channel-outbound-action.ts', import.meta.url), 'utf8');
  assert.match(executor, /row\.dispatch_source !== "HUMAN_MANUAL"/u);
  const adapter = readFileSync(new URL('../src/modules/channels/adapters/zalo/zalo-bridge-adapter.ts', import.meta.url), 'utf8');
  assert.match(adapter, /command\.quoteMessageId && command\.source === "HUMAN_MANUAL" \? \{ quoteMessageId: command\.quoteMessageId \}/u);
});
