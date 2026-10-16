import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/modules/channels/server/channel-actions.ts', import.meta.url), 'utf8');
const section = (name) => source.slice(source.indexOf(`export async function ${name}(`), source.indexOf('\nexport async function', source.indexOf(`export async function ${name}(`) + 10));

test('Zalo groups are refused before any send action is created', () => {
  const send = section('sendManualChannelMessage');
  assert.ok(send.indexOf('isZaloGroupConversation') > 0 && send.indexOf('isZaloGroupConversation') < send.indexOf('propose_channel_message'), 'checked before proposing');
  assert.match(section('dispatchPendingManualChannelMessage'), /isZaloGroupConversation/);
  assert.match(section('approveChannelMessage'), /isZaloGroupConversation/);
});

test('cancelling a pending message only touches never-attempted approved actions', () => {
  const cancel = section('cancelPendingManualChannelMessage');
  assert.match(cancel, /hasPermission\("inbox\.reply"\)/);
  assert.match(cancel, /canAccessChannelAccount/);
  assert.match(cancel, /\.eq\("status", "APPROVED"\)\.eq\("attempt_count", 0\)/);
  assert.match(cancel, /status: "CANCELLED"/);
});
