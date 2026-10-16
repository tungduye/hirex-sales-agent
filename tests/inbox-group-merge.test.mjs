import test from 'node:test';
import assert from 'node:assert/strict';
import { appendPage, groupKeyOf, mergeGroupCopies, rowIndexFor } from '../src/modules/inbox/core/group-merge.ts';

const row = (id, over = {}) => ({ id, channelType: 'ZALO', isGroup: true, providerConversationId: 'g1', lastMessageAt: '2026-10-16T10:00:00Z',
  unreadCount: 0, isPinned: false, latestText: `tin ${id}`, latestDirection: 'INBOUND', senderExternalId: 'member', lastInboundAt: '2026-10-16T10:00:00Z',
  accountDisplayName: `Nick ${id}`, groupKey: null, copyIds: [id], ...over });

test('only Zalo groups are mergeable; one-to-one chats with the same person stay separate', () => {
  assert.equal(groupKeyOf(row('a')), 'ZALO:g1');
  assert.equal(groupKeyOf(row('a', { isGroup: false })), null);
  assert.equal(groupKeyOf(row('a', { channelType: 'FACEBOOK' })), null);
  const people = mergeGroupCopies([row('a', { isGroup: false }), row('b', { isGroup: false })], new Map());
  assert.equal(people.length, 2);
});

test('copies of one group become one row that opens the nick that last wrote', () => {
  const items = [row('a', { lastMessageAt: '2026-10-16T10:05:00Z', unreadCount: 2, latestText: 'mới nhất' }), row('x', { providerConversationId: 'other' }), row('b', { unreadCount: 3, isPinned: true }), row('c')];
  const merged = mergeGroupCopies(items, new Map([['b', '2026-10-16T09:00:00Z'], ['c', '2026-10-15T09:00:00Z']]));
  assert.deepEqual(merged.map((item) => item.id), ['b', 'x']);
  const group = merged[0];
  assert.equal(group.accountDisplayName, 'Nick b', 'shows the nick it opens');
  assert.equal(group.latestText, 'mới nhất', 'preview from the newest copy');
  assert.equal(group.lastMessageAt, '2026-10-16T10:05:00Z');
  assert.equal(group.unreadCount, 3, 'highest unread, not the sum');
  assert.equal(group.isPinned, true);
  assert.deepEqual(group.copyIds, ['b', 'a', 'c']);
});

test('without any message from our nicks the newest copy is opened', () => {
  const merged = mergeGroupCopies([row('a'), row('b')], new Map());
  assert.equal(merged[0].id, 'a');
  assert.deepEqual(merged[0].copyIds, ['a', 'b']);
});

test('a later page joins copies to the listed group row and live messages find it', () => {
  const first = mergeGroupCopies([row('a'), row('b')], new Map());
  const next = appendPage(first, [{ ...row('c'), groupKey: 'ZALO:g1' }, { ...row('d', { providerConversationId: 'g2' }), groupKey: 'ZALO:g2' }, { ...row('a'), groupKey: 'ZALO:g1' }]);
  assert.equal(next.length, 2);
  assert.deepEqual(next[0].copyIds, ['a', 'b', 'c']);
  assert.equal(rowIndexFor(next, 'c'), 0);
  assert.equal(rowIndexFor(next, 'd'), 1);
  assert.equal(rowIndexFor(next, 'zz'), -1);
});
