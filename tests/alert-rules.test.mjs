import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, channelProblem, diffAlerts, MAX_WAIT_ALERTS_PER_MEMBER } from '../src/modules/assistant/core/alert-rules.ts';

const admin = { id: 'admin', isAdmin: true, permissions: [], allChannels: true, channelIds: [] };
const zaloStaff = { id: 'staff', isAdmin: false, permissions: ['inbox.view', 'inbox.reply'], allChannels: false, channelIds: ['zalo-1'] };
const viewer = { id: 'viewer', isAdmin: false, permissions: ['inbox.view'], allChannels: true, channelIds: [] };
const manager = { id: 'manager', isAdmin: false, permissions: ['channels.manage', 'campaigns.launch'], allChannels: false, channelIds: ['zalo-1'] };
const members = [admin, zaloStaff, viewer, manager];
const channel = (extra) => ({ id: 'zalo-1', type: 'ZALO', name: 'Linh', status: 'CONNECTED', operatorEnabled: true, health: 'HEALTHY', healthReason: null, lastError: null, ...extra });
const wait = (extra) => ({ id: 'c1', channelAccountId: 'zalo-1', channel: 'ZALO', name: 'An', account: 'Linh', hours: 5, group: false, automated: false, assignedTo: null, lastInboundId: 'm1', ...extra });
const base = { waitHours: 4, members, channels: [], emailWorker: null, waiting: [] };
const who = (alerts, kind) => alerts.filter((alert) => alert.kind === kind).map((alert) => alert.userId).sort();

test('channel problems: same rule as the brief', () => {
  assert.equal(channelProblem(channel()), null);
  assert.equal(channelProblem(channel({ health: 'UNKNOWN' })), null, 'unchecked health is not a problem');
  assert.equal(channelProblem(channel({ operatorEnabled: false, status: 'DISCONNECTED' })), null, 'switched off on purpose');
  assert.equal(channelProblem(channel({ status: 'DISCONNECTED' })), 'DISCONNECTED');
  assert.equal(channelProblem(channel({ health: 'AUTH_REQUIRED', healthReason: 'TOKEN_EXPIRED' })), 'TOKEN_EXPIRED');
  assert.equal(channelProblem(channel({ lastError: 'EMAIL_SYNC_ERROR' })), 'EMAIL_SYNC_ERROR');
});

test('a broken channel alerts admins and channel managers who can use that account', () => {
  const alerts = buildAlerts({ ...base, channels: [channel({ status: 'DISCONNECTED' }), channel({ id: 'zalo-2', status: 'DISCONNECTED' })] });
  assert.deepEqual(alerts.filter((a) => a.dedupeKey === 'channel:zalo-1').map((a) => a.userId).sort(), ['admin', 'manager']);
  assert.deepEqual(alerts.filter((a) => a.dedupeKey === 'channel:zalo-2').map((a) => a.userId), ['admin'], 'manager has no access to zalo-2');
  assert.equal(alerts[0].severity, 'high');
});

test('e-mail sender stopped alerts only when campaigns are running', () => {
  assert.deepEqual(who(buildAlerts({ ...base, emailWorker: { state: 'STALE', runningCampaigns: 0 } }), 'EMAIL_WORKER_STALE'), []);
  assert.deepEqual(who(buildAlerts({ ...base, emailWorker: { state: 'WARNING', runningCampaigns: 3 } }), 'EMAIL_WORKER_STALE'), []);
  assert.deepEqual(who(buildAlerts({ ...base, emailWorker: { state: 'STALE', runningCampaigns: 3 } }), 'EMAIL_WORKER_STALE'), ['admin', 'manager']);
});

test('waiting customers: assignee first, otherwise members who can reply on that account', () => {
  assert.deepEqual(who(buildAlerts({ ...base, waiting: [wait()] }), 'CUSTOMER_WAITING'), ['admin', 'staff'], 'viewer cannot reply');
  assert.deepEqual(who(buildAlerts({ ...base, waiting: [wait({ assignedTo: 'staff' })] }), 'CUSTOMER_WAITING'), ['staff']);
  assert.deepEqual(who(buildAlerts({ ...base, waiting: [wait({ assignedTo: 'gone' })] }), 'CUSTOMER_WAITING'), ['admin', 'staff'], 'unknown assignee falls back');
  for (const extra of [{ hours: 3 }, { hours: 60 }, { group: true }, { automated: true }]) {
    assert.equal(buildAlerts({ ...base, waiting: [wait(extra)] }).length, 0, JSON.stringify(extra));
  }
  const alert = buildAlerts({ ...base, waiting: [wait({ hours: 30 })] })[0];
  assert.equal(alert.severity, 'high');
  assert.equal(alert.dedupeKey, 'wait:c1:m1', 'a new customer message starts a new episode');
  assert.equal(alert.link, '/inbox/all/c1');
  assert.match(alert.title, /An đang chờ trả lời 1 ngày 6 giờ/);
});

test('waiting alerts are capped per member, longest first', () => {
  const many = Array.from({ length: MAX_WAIT_ALERTS_PER_MEMBER + 5 }, (_, index) => wait({ id: `c${index}`, hours: 5 + index }));
  const mine = buildAlerts({ ...base, members: [zaloStaff], waiting: many });
  assert.equal(mine.length, MAX_WAIT_ALERTS_PER_MEMBER);
  assert.ok(mine.some((alert) => alert.dedupeKey.startsWith(`wait:c${MAX_WAIT_ALERTS_PER_MEMBER + 4}:`)), 'longest wait kept');
});

test('diff: create new problems once, resolve fixed ones, keep the rest', () => {
  const desired = buildAlerts({ ...base, channels: [channel({ status: 'DISCONNECTED' })] });
  const first = diffAlerts([...desired, ...desired], []);
  assert.equal(first.toCreate.length, 2, 'duplicates collapse');
  const open = first.toCreate.map((alert, index) => ({ id: `a${index}`, userId: alert.userId, dedupeKey: alert.dedupeKey }));
  const again = diffAlerts(desired, open);
  assert.deepEqual([again.toCreate.length, again.toResolve.length], [0, 0], 'no repeat while the problem lasts');
  assert.deepEqual(diffAlerts([], open).toResolve.sort(), ['a0', 'a1'], 'fixed problem resolves');
});

test('robot e-mail and Zalo group threads are recognised', async () => {
  const { isAutomatedSender, isZaloGroupThread } = await import('../src/modules/assistant/core/assistant-tools.ts');
  for (const address of ['no-reply@accounts.google.com', 'noreply-accounts@google.com', 'registration@facebookmail.com', 'security@facebookmail.com', 'notifications@github.com', 'mailer-daemon@googlemail.com'])
    assert.equal(isAutomatedSender(address), true, address);
  for (const address of ['nam.nguyen@gmail.com', 'hr@intalent.vn', 'nora@x.com', null])
    assert.equal(isAutomatedSender(address), false, String(address));
  assert.equal(isZaloGroupThread('ZALO', '123', '123'), false, 'one-to-one: thread id = the person');
  assert.equal(isZaloGroupThread('ZALO', 'g-999', '123'), true, 'group: someone else writes in the thread');
  assert.equal(isZaloGroupThread('EMAIL', 'thread-1', 'a@b.com'), false, 'other channels are not judged this way');
});
