import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMentions, parseMentions, MENTION_ALL } from '../src/modules/channels/core/zalo-mentions.ts';

test('picked members become Zalo mentions at the right place', () => {
  const text = '@Hoàng Toản @Tùng Phát Triển ưu tiên họp nhé @All';
  const mentions = buildMentions(text, [{ uid: '11', name: 'Hoàng Toản' }, { uid: '22', name: 'Tùng Phát Triển' }, MENTION_ALL]);
  assert.deepEqual(mentions, [{ pos: 0, len: 11, uid: '11' }, { pos: 12, len: 16, uid: '22' }, { pos: 45, len: 4, uid: '-1' }]);
  for (const m of mentions) assert.equal(text[m.pos], '@');
});

test('a pick whose text was deleted is dropped; the longest name wins; word boundary respected', () => {
  assert.deepEqual(buildMentions('Chào cả nhà', [{ uid: '11', name: 'Lan' }]), []);
  assert.deepEqual(buildMentions('@Lan Anh ơi', [{ uid: '1', name: 'Lan' }, { uid: '2', name: 'Lan Anh' }]), [{ pos: 0, len: 8, uid: '2' }]);
  assert.deepEqual(buildMentions('@Lanh ơi', [{ uid: '1', name: 'Lan' }]), []);
});

test('mentions from the browser are checked strictly', () => {
  const text = '@Lan ơi xem nhé';
  assert.deepEqual(parseMentions([{ pos: 0, len: 4, uid: '11' }], text), [{ pos: 0, len: 4, uid: '11' }]);
  for (const bad of [[], [{ pos: 1, len: 4, uid: '11' }], [{ pos: 0, len: 40, uid: '11' }], [{ pos: 0, len: 4, uid: 'abc' }],
    [{ pos: 0, len: 4, uid: '11', extra: 1 }], [{ pos: 0, len: 4, uid: '11' }, { pos: 2, len: 3, uid: '12' }], 'x'])
    assert.equal(parseMentions(bad, text), null);
});

test('the "@query" before the caret is found only at a word start', async () => {
  const { mentionQueryAt } = await import('../src/modules/channels/core/zalo-mentions.ts');
  assert.deepEqual(mentionQueryAt('Chào @Ho', 8), { start: 5, query: 'Ho' });
  assert.deepEqual(mentionQueryAt('@', 1), { start: 0, query: '' });
  assert.equal(mentionQueryAt('mail a@b', 8), null);
  assert.equal(mentionQueryAt('@Lan\nxin', 8), null);
});

test('suggestions ignore accents and offer @All', async () => {
  const { suggestMembers } = await import('../src/modules/channels/core/zalo-mentions.ts');
  const members = [{ uid: '1', name: 'Hoàng Toản' }, { uid: '2', name: 'Đức Dũng' }, { uid: '3', name: 'Tùng Phát Triển' }];
  assert.deepEqual(suggestMembers(members, 'toan').map((m) => m.uid), ['1']);
  assert.deepEqual(suggestMembers(members, 'duc').map((m) => m.uid), ['2']);
  assert.equal(suggestMembers(members, '')[0].uid, '-1');
  assert.equal(suggestMembers(members, 'tat')[0].uid, '-1');
});

test('mentions are saved only for Zalo groups and travel with the group send', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const actions = read('modules/channels/server/channel-actions.ts');
  assert.match(actions, /parseMentions\(JSON\.parse\(rawMentions\), parsed\.data\.text\)/);
  assert.match(actions, /rpc\("is_zalo_group_conversation", \{ p_conversation_id: parsed\.data\.conversationId \}\)/);
  assert.match(read('modules/channels/server/execute-channel-outbound-action.ts'), /threadKind === "GROUP" && row\.dispatch_source === "HUMAN_MANUAL"/);
  assert.match(read('modules/channels/adapters/zalo/zalo-bridge-adapter.ts'), /threadType: "GROUP", \.\.\.\(command\.mentions\?\.length \? \{ mentions: command\.mentions \} : \{\}\)/);
  assert.match(read('modules/channels/components/conversation-composer.tsx'), /name="mentions" value=\{JSON\.stringify\(mentions\)\}/);
});
