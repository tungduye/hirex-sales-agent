import test from 'node:test';
import assert from 'node:assert/strict';
import { ambiguousGroupKeys, appendPage, groupKeyOf, mergeGroupCopies, rowIndexFor } from '../src/modules/inbox/core/group-merge.ts';

// Zalo gives each nick its own id for the same group, so copies are matched by group name.
const row = (id, over = {}) => ({ id, channelAccountId: `acc-${id}`, channelType: 'ZALO', isGroup: true, subject: 'Nick Intalent _ Quản lý',
  providerConversationId: `zid-${id}`, lastMessageAt: '2026-10-16T10:00:00Z', unreadCount: 0, isPinned: false, latestText: `tin ${id}`,
  latestDirection: 'INBOUND', senderExternalId: 'member', lastInboundAt: '2026-10-16T10:00:00Z', accountDisplayName: `Nick ${id}`,
  groupKey: null, copyIds: [id], copyAccountIds: [`acc-${id}`], ...over });

test('only named Zalo groups are mergeable; one-to-one chats stay separate', () => {
  assert.equal(groupKeyOf(row('a')), 'ZALO:nick intalent _ quản lý');
  assert.equal(groupKeyOf(row('a', { subject: '  Nick  Intalent _ QUẢN LÝ ' })), 'ZALO:nick intalent _ quản lý');
  assert.equal(groupKeyOf(row('a', { isGroup: false })), null);
  assert.equal(groupKeyOf(row('a', { channelType: 'FACEBOOK' })), null);
  assert.equal(groupKeyOf(row('a', { subject: null })), null);
  assert.equal(mergeGroupCopies([row('a', { isGroup: false }), row('b', { isGroup: false })], new Map()).length, 2);
});

test('copies of one group (different ids per nick) become one row that opens the nick that last wrote', () => {
  const items = [row('a', { lastMessageAt: '2026-10-16T10:05:00Z', unreadCount: 2, latestText: 'mới nhất' }), row('x', { subject: 'Nhóm khác' }), row('b', { unreadCount: 3, isPinned: true }), row('c')];
  const merged = mergeGroupCopies(items, new Map([['b', '2026-10-16T09:00:00Z'], ['c', '2026-10-15T09:00:00Z']]));
  assert.deepEqual(merged.map((item) => item.id), ['b', 'x']);
  const group = merged[0];
  assert.equal(group.accountDisplayName, 'Nick b', 'shows the nick it opens');
  assert.equal(group.latestText, 'mới nhất', 'preview from the newest copy');
  assert.equal(group.lastMessageAt, '2026-10-16T10:05:00Z');
  assert.equal(group.unreadCount, 3, 'highest unread, not the sum');
  assert.equal(group.isPinned, true);
  assert.deepEqual(group.copyIds, ['b', 'a', 'c']);
  assert.deepEqual(group.copyAccountIds, ['acc-b', 'acc-a', 'acc-c']);
});

test('a name one nick has twice is two different groups and is never merged', () => {
  const merged = mergeGroupCopies([row('a'), row('b', { channelAccountId: 'acc-a' }), row('c')], new Map());
  assert.equal(merged.length, 3);
  assert.ok(merged.every((item) => item.copyIds.length === 1));
});

test('without any message from our nicks the newest copy is opened', () => {
  const merged = mergeGroupCopies([row('a'), row('b')], new Map());
  assert.equal(merged[0].id, 'a');
  assert.deepEqual(merged[0].copyIds, ['a', 'b']);
});

test('a later page joins copies to the listed group row (one per nick) and live messages find it', () => {
  const first = mergeGroupCopies([row('a'), row('b')], new Map());
  const key = first[0].groupKey;
  const next = appendPage(first, [{ ...row('c'), groupKey: key }, { ...row('d', { subject: 'Khác' }), groupKey: 'ZALO:khác' }, { ...row('a'), groupKey: key }, { ...row('e', { channelAccountId: 'acc-a' }), groupKey: key, copyAccountIds: ['acc-a'] }]);
  assert.equal(next.length, 3, 'same-name copy from a nick already in the row stays separate');
  assert.deepEqual(next[0].copyIds, ['a', 'b', 'c']);
  assert.equal(next[2].groupKey, null);
  assert.equal(rowIndexFor(next, 'c'), 0);
  assert.equal(rowIndexFor(next, 'd'), 1);
  assert.equal(rowIndexFor(next, 'zz'), -1);
});

test('names a nick has twice anywhere (not only on this page) are left unmerged', () => {
  const ambiguous = ambiguousGroupKeys([{ subject: 'Nick Intalent _ Quản lý', channelAccountId: 'acc-a' }, { subject: 'nick intalent _ quản lý ', channelAccountId: 'acc-a' },
    { subject: 'Nhóm khác', channelAccountId: 'acc-a' }, { subject: 'Nhóm khác', channelAccountId: 'acc-b' }]);
  assert.deepEqual([...ambiguous], ['ZALO:nick intalent _ quản lý']);
  const merged = mergeGroupCopies([row('a'), row('b'), row('c')], new Map(), ambiguous);
  assert.equal(merged.length, 3);
  assert.ok(merged.every((item) => item.groupKey === null));
});

test('overlapping pages: copies already listed are skipped and the rest join the group row', () => {
  const first = mergeGroupCopies([row('a'), row('b'), row('c')], new Map());
  const key = first[0].groupKey;
  const overlap = { ...row('d'), groupKey: key, copyIds: ['d', 'e', 'c', 'b'], copyAccountIds: ['acc-d', 'acc-e', 'acc-c', 'acc-b'] };
  const next = appendPage(first, [overlap]);
  assert.equal(next.length, 1);
  assert.deepEqual(next[0].copyIds, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(appendPage(next, [{ ...row('b'), groupKey: key }]).length, 1, 'a fully listed row adds nothing');
});
