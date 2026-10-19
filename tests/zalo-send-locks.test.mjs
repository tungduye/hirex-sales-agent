import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { autoReleaseAt, decide, findSentMessage, messageText, recordedLaterActivity, selectHeldLocks, GIVE_UP_MS, WAIT_MS } from '../scripts/lib/zalo-send-locks.mjs';
import { describeSendLock, lockAge } from '../src/modules/channels/core/send-locks.ts';

const at = Date.parse('2026-10-11T17:14:30.232Z');
const lock = { accountId: '716', idempotencyKey: 'channel-campaign:a:b:c', threadId: '238', state: 'UNKNOWN', reconciliationStatus: 'NONE', invokedAt: new Date(at).toISOString() };

function deplao(rows) {
  const db = new DatabaseSync(':memory:');
  db.exec('create table messages (id integer primary key, msg_id text, owner_zalo_id text, thread_id text, content text, timestamp integer, is_sent integer)');
  const insert = db.prepare('insert into messages(msg_id,owner_zalo_id,thread_id,content,timestamp,is_sent) values(?,?,?,?,?,?)');
  for (const row of rows) insert.run(...row);
  return db;
}

test('held locks are read from the adapter gates with the send that holds them', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table send_ledger (id text, hirex_idempotency_key text, account_id text, thread_id text, state text, reconciliation_status text, provider_invoked_at text, execution_started_at text, started_at text, created_at text);
    create table account_gates (account_id text, active_ledger_id text);
    insert into send_ledger values ('l1','k1','716','238','UNKNOWN','NONE','2026-10-11T17:14:30.232Z',null,null,'2026-10-11T17:14:30Z'),('l2','k2','640','9','SENT','NONE',null,null,null,'x');
    insert into account_gates values ('716','l1'),('640',null)`);
  assert.deepEqual(selectHeldLocks(db), [{ accountId: '716', idempotencyKey: 'k1', threadId: '238', state: 'UNKNOWN', reconciliationStatus: 'NONE', invokedAt: '2026-10-11T17:14:30.232Z' }]);
});

test('a delivered message is found by nick, chat, time and text', () => {
  const db = deplao([
    ['m-other-thread', '716', '999', 'Em chào anh', at + 1000, 1],
    ['m-inbound', '716', '238', 'Em chào anh', at + 2000, 0],
    ['m-late', '716', '238', 'Em chào anh', at + 20 * 60_000, 1],
    ['m-ok', '716', '238', 'Em  chào\nanh ', at + 2500, 1],
  ]);
  assert.deepEqual(findSentMessage(db, lock, 'Em chào anh'), { msgId: 'm-ok', threadId: '238', timestamp: at + 2500 });
  assert.equal(findSentMessage(db, lock, 'Nội dung khác'), null);
  assert.equal(findSentMessage(db, { ...lock, accountId: '640' }, 'Em chào anh'), null);
});

test('without text (attachment only) exactly one sent message must exist', () => {
  assert.equal(findSentMessage(deplao([['a', '716', '238', '', at, 1], ['b', '716', '238', '', at + 10, 1]]), lock, null), null);
  assert.equal(findSentMessage(deplao([['a', '716', '238', '', at, 1]]), lock, null).msgId, 'a');
});

test('JSON message content is read for its text', () => {
  assert.equal(messageText('{"title":"Xin chào","href":"x"}'), 'Xin chào');
  assert.equal(messageText('{ not json'), '{ not json');
});

test('found -> confirm; not found -> wait, then release once Deplao proved it was listening, or after the give-up time', () => {
  const active = deplao([['later', '716', '1', 'x', at + 40 * 60_000, 0]]), quiet = deplao([]);
  assert.equal(decide(lock, { msgId: 'm' }, false, at + 1000), 'CONFIRM');
  assert.equal(decide(lock, null, recordedLaterActivity(active, lock), at + WAIT_MS - 1), 'WAIT');
  assert.equal(decide(lock, null, recordedLaterActivity(active, lock), at + WAIT_MS), 'RELEASE');
  assert.equal(decide(lock, null, recordedLaterActivity(quiet, lock), at + WAIT_MS), 'WAIT');
  assert.equal(decide(lock, null, false, at + GIVE_UP_MS), 'RELEASE');
  assert.equal(decide({ ...lock, state: 'EXECUTING' }, { msgId: 'm' }, true, at + GIVE_UP_MS), 'WAIT');
  assert.equal(autoReleaseAt(lock), new Date(at + WAIT_MS).toISOString());
});

test('the lock warning says what happens next, in Vietnamese', () => {
  const view = { channelAccountId: 'a', accountName: 'Flora', reason: 'DELIVERY_UNKNOWN', lockedSince: new Date(at).toISOString(), autoReleaseAt: new Date(at + WAIT_MS).toISOString(), conversationId: 'c' };
  assert.match(describeSendLock(view, at + 5 * 60_000), /chưa rõ đã tới khách chưa \(5 phút\).*tự mở khoá lúc 00:44/u);
  assert.match(describeSendLock(view, at + 3 * 86_400_000), /3 ngày.*trong ít phút/u);
  assert.match(describeSendLock({ ...view, reason: 'SENDING' }, at), /Đang gửi một tin \(vừa xong\)/u);
  assert.equal(lockAge(view.lockedSince, at + 90 * 60_000), '1 giờ');
});

test('the supervisor runs the reconciler and restarts itself after a deploy', () => {
  const source = readFileSync(new URL('../scripts/deplao-realtime-supervisor.mjs', import.meta.url), 'utf8');
  assert.match(source, /schedule\("send-lock-reconcile", "reconcile-zalo-send-locks\.mjs", \["--once"\]/u);
  assert.match(source, /SUPERVISOR_RESTART_NEW_CODE/u);
});
