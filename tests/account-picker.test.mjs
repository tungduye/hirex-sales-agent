import test from 'node:test';
import assert from 'node:assert/strict';
import { toPickerAccounts } from '../src/modules/access/core/picker-accounts.ts';

test('two accounts with the same name show their address; reconnect is flagged', () => {
  const rows = [
    { id: 'a', channel_type: 'EMAIL', display_name: 'Mai Ngọc', external_account_id: 'ngocmai.intalent@gmail.com', status: 'REAUTH_REQUIRED' },
    { id: 'b', channel_type: 'EMAIL', display_name: 'mai ngoc', external_account_id: 'ngocmai.sale03@gmail.com', status: 'CONNECTED' },
    { id: 'c', channel_type: 'ZALO', display_name: 'Flora', external_account_id: '123', status: 'CONNECTED' },
  ];
  const out = toPickerAccounts(rows);
  assert.deepEqual(out.map((item) => [item.id, item.detail, item.needsReconnect]), [['a', 'ngocmai.intalent@gmail.com', true], ['b', 'ngocmai.sale03@gmail.com', false], ['c', null, false]]);
});
