import test from 'node:test';
import assert from 'node:assert/strict';
import { accountsInGroups, buildTree, cleanGroups, compactSelection, departmentKey, groupLabel } from '../src/modules/inbox/core/account-tree.ts';

const L = '11111111-1111-4111-8111-111111111111', T = '22222222-2222-4222-8222-222222222222', B = '33333333-3333-4333-8333-333333333333';
const nicks = [
  { id: 'n1', displayName: 'Đức Phúc', ownerId: L, ownerName: 'Long', department: 'Rec', market: 'IT_JP' },
  { id: 'n2', displayName: 'Hà Chiii', ownerId: L, ownerName: 'Long', department: 'rec', market: 'IT_JP' },
  { id: 'n3', displayName: 'Phan Đăng Dương', ownerId: L, ownerName: 'Long', department: 'Rec', market: 'IT' },
  { id: 'n4', displayName: 'Flora', ownerId: T, ownerName: 'Tuấn J1', department: 'Rec', market: null },
  { id: 'n5', displayName: 'Sale 1', ownerId: B, ownerName: 'Bích', department: 'Sale', market: 'IT' },
  { id: 'n6', displayName: 'Mồ côi', ownerId: null, ownerName: null, department: null, market: null },
];

test('branches in the agreed order: Bộ phận → Thị trường → Owner → nick', () => {
  const tree = buildTree(nicks);
  assert.deepEqual(tree.map((d) => d.label), ['Sale', 'Rec', 'Chưa xếp bộ phận']);
  const rec = tree[1];
  assert.deepEqual(rec.markets.map((m) => m.label), ['IT', 'IT JP', 'Khác']);
  assert.deepEqual(rec.markets[1].owners[0].accounts.map((a) => a.displayName), ['Đức Phúc', 'Hà Chiii']);
  assert.equal(departmentKey(' rec '), 'Rec');
});

test('a whole branch is kept as a group, so new nicks in it are included', () => {
  const tree = buildTree(nicks);
  assert.deepEqual(compactSelection(tree, new Set(['n1', 'n2', 'n3', 'n4'])), { groups: ['d:Rec'], accounts: [] });
  assert.deepEqual(compactSelection(tree, new Set(['n1', 'n2'])), { groups: ['m:Rec|IT_JP'], accounts: [] });
  assert.deepEqual(compactSelection(tree, new Set(['n1', 'n5'])), { groups: ['d:Sale'], accounts: ['n1'] });
  assert.deepEqual(accountsInGroups([...nicks, { id: 'n7', displayName: 'Nick mới', ownerId: T, ownerName: 'Tuấn J1', department: 'Rec', market: 'IT_JP' }], ['m:Rec|IT_JP']), ['n1', 'n2', 'n7']);
  assert.deepEqual(accountsInGroups(nicks, [`o:Rec|IT_JP|${L}`]), ['n1', 'n2']);
});

test('only well-formed groups are read from the address', () => {
  assert.deepEqual(cleanGroups(['d:Rec', 'm:Rec|IT_JP', 'x:hack', `o:Rec|IT|${L}`, 'm:Rec|USA', 'd:Rec']), ['d:Rec', 'm:Rec|IT_JP', `o:Rec|IT|${L}`]);
  assert.equal(groupLabel('m:Rec|IT_JP', () => null), 'Rec › IT JP');
  assert.equal(groupLabel(`o:Rec|IT|${L}`, (id) => id === L ? 'Long' : null), 'Long · IT');
});
