import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScope, scopeAccounts, scopeFromCookie, teamOf } from '../src/modules/inbox/core/inbox-scope.ts';

const managers = [{ id: 'hai', managerId: 'ngoc' }, { id: 'duong', managerId: 'hai' }, { id: 'cuong', managerId: 'hai' }, { id: 'tung', managerId: 'duong' }, { id: 'x', managerId: 'y' }, { id: 'y', managerId: 'x' }];
const accounts = [{ id: 'a1', primaryProfileId: 'hai' }, { id: 'a2', primaryProfileId: 'duong' }, { id: 'a3', primaryProfileId: 'tung' }, { id: 'a4', primaryProfileId: 'x' }, { id: 'a5', primaryProfileId: null }];

test('team: everyone below me, cycles ignored', () => {
  assert.deepEqual([...teamOf('hai', managers)].sort(), ['cuong', 'duong', 'hai', 'tung']);
  assert.deepEqual([...teamOf('x', managers)].sort(), ['x', 'y']);
});

test('scope picks the accounts', () => {
  assert.deepEqual(scopeAccounts('MINE', 'hai', accounts, managers), ['a1']);
  assert.deepEqual(scopeAccounts('TEAM', 'hai', accounts, managers), ['a1', 'a2', 'a3']);
  assert.deepEqual(scopeAccounts('ALL', 'hai', accounts, managers), ['a1', 'a2', 'a3', 'a4', 'a5']);
});

test('default scope and fallbacks', () => {
  assert.equal(resolveScope(null, { mine: 2, team: 5, hasTeam: true }), 'MINE');
  assert.equal(resolveScope(null, { mine: 0, team: 0, hasTeam: false }), 'ALL');
  assert.equal(resolveScope('TEAM', { mine: 1, team: 1, hasTeam: false }), 'MINE');
  assert.equal(resolveScope('team', { mine: 1, team: 4, hasTeam: true }), 'TEAM');
  assert.equal(resolveScope('ALL', { mine: 1, team: 1, hasTeam: false }), 'ALL');
  assert.equal(scopeFromCookie('a=1; hirex_inbox_scope=TEAM; b=2'), 'TEAM');
  assert.equal(scopeFromCookie(null), null);
});
