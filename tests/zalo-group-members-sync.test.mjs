import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mapGroupMemberRow, selectChangedMembers } from '../scripts/lib/zalo-group-members.mjs';

const account = { id: 'acc-1', workspace_id: 'ws-1' };

test('member rows map to HireX rows; unnamed or malformed rows are skipped', () => {
  const row = mapGroupMemberRow({ group_id: '900', member_id: '11', display_name: '  Lan\n Anh ', avatar: 'https://s120.avatar.talk.zdn.vn/a.jpg', role: 1, updated_at: 1792206385902 }, account);
  assert.deepEqual(row, { workspace_id: 'ws-1', channel_account_id: 'acc-1', group_id: '900', member_id: '11', display_name: 'Lan Anh',
    avatar_url: 'https://s120.avatar.talk.zdn.vn/a.jpg', role: 1, updated_at: new Date(1792206385902).toISOString() });
  assert.equal(mapGroupMemberRow({ group_id: '900', member_id: '11', display_name: '', avatar: '', role: 0, updated_at: 1 }, account), null);
  assert.equal(mapGroupMemberRow({ group_id: 'x', member_id: '11', display_name: 'A', avatar: '', role: 0, updated_at: 1 }, account), null);
  assert.equal(mapGroupMemberRow({ group_id: '900', member_id: '11', display_name: 'A', avatar: 'javascript:x', role: 0, updated_at: 1 }, account).avatar_url, null);
});

test('incremental reading does not skip rows that share a timestamp across batches', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table page_group_member (id integer primary key autoincrement, owner_zalo_id text, group_id text, member_id text, display_name text, avatar text, role integer, updated_at integer)`);
  const insert = db.prepare('insert into page_group_member(owner_zalo_id,group_id,member_id,display_name,avatar,role,updated_at) values(?,?,?,?,?,?,?)');
  for (let index = 0; index < 5; index++) insert.run('100', '900', String(10 + index), `M${index}`, '', 0, 1000);
  insert.run('200', '900', '99', 'Other nick', '', 0, 1000);
  let cursor = { at: 0, id: 0 }; const seen = [];
  for (;;) { const rows = selectChangedMembers(db, '100', cursor, 2); if (!rows.length) break; seen.push(...rows.map((r) => r.member_id)); cursor = { at: rows.at(-1).updated_at, id: rows.at(-1).id }; }
  assert.deepEqual(seen, ['10', '11', '12', '13', '14']);
});
