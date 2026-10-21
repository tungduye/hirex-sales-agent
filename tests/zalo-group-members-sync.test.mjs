import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mapGroupMemberRow, selectChangedMembers, selectRecentSendersOutsideList } from '../scripts/lib/zalo-group-members.mjs';

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
  db.exec(`create table page_group_member (id integer primary key autoincrement, owner_zalo_id text, group_id text, member_id text, display_name text, avatar text, role integer, updated_at integer);
    create table friends (owner_zalo_id text, user_id text, display_name text, avatar text);
    create table contacts (owner_zalo_id text, contact_id text, display_name text, avatar_url text)`);
  const insert = db.prepare('insert into page_group_member(owner_zalo_id,group_id,member_id,display_name,avatar,role,updated_at) values(?,?,?,?,?,?,?)');
  for (let index = 0; index < 5; index++) insert.run('100', '900', String(10 + index), `M${index}`, '', 0, 1000);
  insert.run('200', '900', '99', 'Other nick', '', 0, 1000);
  let cursor = { at: 0, id: 0 }; const seen = [];
  for (;;) { const rows = selectChangedMembers(db, '100', cursor, 2); if (!rows.length) break; seen.push(...rows.map((r) => r.member_id)); cursor = { at: rows.at(-1).updated_at, id: rows.at(-1).id }; }
  assert.deepEqual(seen, ['10', '11', '12', '13', '14']);
});

test('missing names come from the same nick\'s friends or contacts, and recent writers outside the list are added', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table page_group_member (id integer primary key autoincrement, owner_zalo_id text, group_id text, member_id text, display_name text, avatar text, role integer, updated_at integer);
    create table friends (owner_zalo_id text, user_id text, display_name text, avatar text);
    create table contacts (owner_zalo_id text, contact_id text, display_name text, avatar_url text);
    create table messages (id integer primary key, owner_zalo_id text, thread_id text, thread_type integer, sender_id text, is_sent integer, timestamp integer, channel text);
    insert into page_group_member(owner_zalo_id,group_id,member_id,display_name,avatar,role,updated_at) values('100','900','11','','',0,5),('100','900','12','','',0,6),('100','900','13','Có tên','',0,7);
    insert into friends values('100','11','Bạn Lan','https://a/lan.jpg'),('200','12','Nick khác thấy','');
    insert into contacts values('100','12','Liên hệ Huy',''),('100','14','Người ngoài danh sách','');
    insert into messages(owner_zalo_id,thread_id,thread_type,sender_id,is_sent,timestamp,channel) values('100','900',1,'14',0,1000,'zalo'),('100','900',1,'13',0,1000,'zalo'),('100','900',1,'99',0,1000,'zalo'),('100','900',1,'system',0,1000,'zalo')`);
  const rows = selectChangedMembers(db, '100', { at: 0, id: 0 });
  assert.deepEqual(rows.map((r) => [r.member_id, r.display_name, r.avatar]), [['11', 'Bạn Lan', 'https://a/lan.jpg'], ['12', 'Liên hệ Huy', ''], ['13', 'Có tên', '']]);
  const extras = selectRecentSendersOutsideList(db, '100', 0);
  assert.deepEqual(extras.map((r) => [r.group_id, r.member_id, r.display_name]), [['900', '14', 'Người ngoài danh sách']]);
});

test('a writer this nick cannot name is named through another of our nicks that saw the same message', async () => {
  const { selectCrossNickSenders } = await import('../scripts/lib/zalo-group-members.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(`create table page_group_member (id integer primary key autoincrement, owner_zalo_id text, group_id text, member_id text, display_name text, avatar text, role integer, updated_at integer);
    create table friends (owner_zalo_id text, user_id text, display_name text, avatar text);
    create table contacts (owner_zalo_id text, contact_id text, display_name text, avatar_url text);
    create table accounts (zalo_id text, full_name text, avatar_url text);
    create table messages (id integer primary key, msg_id text, owner_zalo_id text, thread_id text, thread_type integer, sender_id text, is_sent integer, timestamp integer, channel text);
    insert into accounts values ('FLORA','Flora',''),('STELLA','Stella Nguyen','https://a/stella.jpg'),('NHUNG','Hồng Nhung','');
    -- Stella wrote m1: Stella's copy is sent; Flora sees it from id 79.
    insert into messages(msg_id,owner_zalo_id,thread_id,thread_type,sender_id,is_sent,timestamp,channel) values
      ('m1','STELLA','g-s',1,'STELLA',1,1000,'zalo'),('m1','FLORA','g-f',1,'79',0,1000,'zalo'),
      ('m2','NHUNG','g-n',1,'555',0,2000,'zalo'),('m2','FLORA','g-f',1,'88',0,2000,'zalo'),
      ('m3','FLORA','g-f',1,'99',0,3000,'zalo');
    insert into page_group_member(owner_zalo_id,group_id,member_id,display_name,avatar,role,updated_at) values('NHUNG','g-n','555','Leonard','',0,1)`);
  const rows = selectCrossNickSenders(db, 'FLORA', 0).map((row) => [row.group_id, row.member_id, row.display_name, row.avatar]);
  assert.deepEqual(rows, [['g-f', '79', 'Stella Nguyen', 'https://a/stella.jpg'], ['g-f', '88', 'Leonard', '']]);
});

test('a group a nick knows only by id is named from its own contacts or from another nick in the same group', async () => {
  const { selectGroupNames } = await import('../scripts/lib/zalo-group-members.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(`create table contacts (owner_zalo_id text, contact_id text, display_name text, contact_type text default 'user');
    create table messages (id integer primary key, msg_id text, owner_zalo_id text, thread_id text, thread_type integer, channel text, timestamp integer);
    insert into contacts(owner_zalo_id,contact_id,display_name) values ('MINA','g-own','Nhóm có tên'),('MINA','g-m','22'),('STELLA','g-s','Nick Intalent _ Quản lý'),('MINA','g-x',''),('MINA','44','30/09 - BRISASOFT - BrSE HN - Mai');
    insert into contacts values ('MINA','55','Nhóm im lặng lâu','group'),('MINA','66','Bạn bè','user');
    insert into messages(msg_id,owner_zalo_id,thread_id,thread_type,channel,timestamp) values
      ('1','MINA','g-own',1,'zalo',100),('2','MINA','g-m',1,'zalo',100),('2','STELLA','g-s',1,'zalo',100),('3','MINA','g-x',1,'zalo',100),('4','MINA','person',0,'zalo',100),('5','MINA','44',1,'zalo',100)`);
  db.exec("update messages set thread_id = case thread_id when 'g-own' then '11' when 'g-m' then '22' when 'g-x' then '33' else thread_id end");
  db.exec("update contacts set contact_id = case contact_id when 'g-own' then '11' when 'g-m' then '22' when 'g-x' then '33' else contact_id end where owner_zalo_id='MINA'");
  const rows = selectGroupNames(db, 'MINA', 0).sort((a, b) => a.threadId.localeCompare(b.threadId));
  assert.deepEqual(rows, [{ threadId: '11', name: 'Nhóm có tên' }, { threadId: '22', name: 'Nick Intalent _ Quản lý' }, { threadId: '44', name: '30/09 - BRISASOFT - BrSE HN - Mai' }, { threadId: '55', name: 'Nhóm im lặng lâu' }], 'groups loaded from Zalo get their name even without recent messages');
});

test('copies of one group across nicks share a key through a shared message, even with different names', async () => {
  const { selectGroupIdentities } = await import('../scripts/lib/zalo-group-members.mjs');
  const db = new DatabaseSync(':memory:');
  db.exec(`create table messages (id integer primary key, msg_id text, owner_zalo_id text, thread_id text, thread_type integer, channel text, timestamp integer);
    insert into messages(msg_id,owner_zalo_id,thread_id,thread_type,channel,timestamp) values
      ('1','30','300',1,'zalo',10),('1','10','100',1,'zalo',10),('2','10','100',1,'zalo',10),('2','20','200',1,'zalo',10),
      ('3','10','101',1,'zalo',10),('4','10','102',0,'zalo',10),('4','20','202',0,'zalo',10)`);
  const keys = selectGroupIdentities(db, 0);
  assert.deepEqual(Object.fromEntries(keys), { '10:100': '10:100', '30:300': '10:100', '20:200': '10:100' });
});
