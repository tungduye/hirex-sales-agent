import test from 'node:test';
import assert from 'node:assert/strict';
import { describeRule, evaluateRules, MAX_RULE_ALERTS_PER_RECIPIENT, ruleFromToolArgs } from '../src/modules/assistant/core/assistant-rules.ts';
import { parseToolCall, toolsFor } from '../src/modules/assistant/core/assistant-tools.ts';

const now = new Date('2026-10-15T03:00:00Z');
const admin = { id: 'admin', isAdmin: true, permissions: [], allChannels: true, channelIds: [] };
const staff = { id: 'staff', isAdmin: false, permissions: ['dashboard.view', 'inbox.view', 'inbox.reply', 'tasks.view', 'tasks.create', 'contacts.view'], allChannels: false, channelIds: ['zalo-1'] };
const other = { id: 'other', isAdmin: false, permissions: ['inbox.view', 'inbox.reply', 'tasks.view'], allChannels: true, channelIds: [] };
const members = [admin, staff, other];
const args = (extra) => ({ ten: 'Nhắc chờ lâu', dieu_kien: 'CUSTOMER_WAITING', so_gio: 3, so_ngay: null, kenh: [], hanh_dong: 'NOTIFY', gui_cho: 'OWNER', han_cong_viec_gio: null, ...extra });
const rule = (ownerId, definition, extra = {}) => ({ id: `r-${ownerId}`, ownerId, name: 'Quy tắc', enabled: true, definition, ...extra });
const waiting = (extra) => ({ id: 'c1', channelAccountId: 'zalo-1', channel: 'ZALO', name: 'An', account: 'Linh', since: '2026-10-14T23:00:00Z', hours: 4, group: false, automated: false, assignedTo: null, lastInboundId: 'm1', ...extra });
const base = { now, members, rules: [], waiting: [], overdueTasks: [], staleLeads: {} };

test('tool arguments become a checked rule; non-admins can only alert themselves', () => {
  const ok = ruleFromToolArgs(args({ kenh: ['ZALO', 'ZALO'] }), false);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.rule, { trigger: 'CUSTOMER_WAITING', hours: 3, channels: ['ZALO'], action: 'NOTIFY', target: 'OWNER', dueHours: 2 });
  assert.equal(ruleFromToolArgs(args({ gui_cho: 'ADMINS' }), false).ok, false);
  assert.equal(ruleFromToolArgs(args({ gui_cho: 'RESPONSIBLE' }), true).ok, true);
  assert.equal(ruleFromToolArgs(args({ so_gio: 0.5 }), true).ok, false, 'at least 1 hour');
  assert.equal(ruleFromToolArgs(args({ so_gio: null }), true).ok, false, 'hours required');
  assert.equal(ruleFromToolArgs(args({ dieu_kien: 'TASK_OVERDUE', so_gio: null, hanh_dong: 'PROPOSE_TASK' }), true).ok, false, 'overdue tasks only notify');
  assert.equal(ruleFromToolArgs(args({ dieu_kien: 'LEAD_STALE', so_gio: null, so_ngay: 2 }), false).ok, true);
  assert.equal(ruleFromToolArgs(args({ ten: '  ' }), true).ok, false);
});

test('rules are described in plain Vietnamese', () => {
  const lines = describeRule({ trigger: 'CUSTOMER_WAITING', hours: 3, channels: ['ZALO'], action: 'PROPOSE_TASK', target: 'OWNER', dueHours: 2 });
  assert.match(lines[0], /chờ trả lời quá 3 giờ \(kênh Zalo\)/);
  assert.match(lines[1], /đề xuất tạo công việc \(hạn 2 giờ\), người nhận bấm Xác nhận/);
  assert.match(lines[2], /người tạo quy tắc/);
});

test('the rule tool needs no special permission and validates strictly', () => {
  const tools = toolsFor(['dashboard.view'], false);
  assert.ok(tools.some((tool) => tool.name === 'de_xuat_tao_quy_tac'));
  assert.ok(tools.some((tool) => tool.name === 'quy_tac_tu_dong'));
  assert.equal(parseToolCall('de_xuat_tao_quy_tac', JSON.stringify(args()), tools).ok, true);
  assert.equal(parseToolCall('de_xuat_tao_quy_tac', JSON.stringify({ ...args(), hanh_dong: 'SEND_MESSAGE' }), tools).ok, false, 'no sending action exists');
});

test('waiting rule: owner only sees conversations they can access; proposals need tasks.create', () => {
  const definition = { trigger: 'CUSTOMER_WAITING', hours: 3, channels: [], action: 'PROPOSE_TASK', target: 'OWNER', dueHours: 2 };
  const mine = evaluateRules({ ...base, rules: [rule('staff', definition)], waiting: [waiting(), waiting({ id: 'c2', channelAccountId: 'fb-9' }), waiting({ id: 'c3', hours: 2 }), waiting({ id: 'c4', group: true })] });
  assert.deepEqual(mine.map((alert) => alert.dedupeKey), ['rule:r-staff:wait:c1:m1']);
  assert.equal(mine[0].kind, 'RULE');
  assert.equal(mine[0].ruleId, 'r-staff');
  assert.match(mine[0].title, /^\[Quy tắc\] An chờ trả lời từ 06:00 15\/10$/);
  assert.equal(mine[0].proposal.kind, 'CREATE_TASK');
  assert.deepEqual(mine[0].proposal.params, { title: 'Trả lời An (Zalo)', dueAt: '2026-10-15T05:00:00.000Z', conversationId: 'c1', assigneeId: 'staff' });
  const noTasks = evaluateRules({ ...base, rules: [rule('other', definition)], waiting: [waiting()] });
  assert.equal(noTasks.length, 1);
  assert.equal(noTasks[0].proposal, undefined, 'no tasks.create: notify only');
});

test('channel filter and responsible people (admin rule)', () => {
  const definition = { trigger: 'CUSTOMER_WAITING', hours: 3, channels: ['EMAIL'], action: 'NOTIFY', target: 'RESPONSIBLE', dueHours: 2 };
  assert.equal(evaluateRules({ ...base, rules: [rule('admin', definition)], waiting: [waiting()] }).length, 0, 'Zalo filtered out');
  const zalo = { ...definition, channels: [] };
  assert.deepEqual(evaluateRules({ ...base, rules: [rule('admin', zalo)], waiting: [waiting()] }).map((a) => a.userId).sort(), ['admin', 'other', 'staff']);
  assert.deepEqual(evaluateRules({ ...base, rules: [rule('admin', zalo)], waiting: [waiting({ assignedTo: 'staff' })] }).map((a) => a.userId), ['staff']);
  // A non-admin rule saying RESPONSIBLE (stored before a role change) still only reaches its owner.
  assert.deepEqual(evaluateRules({ ...base, rules: [rule('staff', zalo)], waiting: [waiting()] }).map((a) => a.userId), ['staff']);
});

test('overdue tasks: own tasks for members, all for admins; disabled rules do nothing', () => {
  const definition = { trigger: 'TASK_OVERDUE', hours: 2, action: 'NOTIFY', target: 'OWNER' };
  const tasks = [
    { id: 't1', title: 'Gọi lại', assignedTo: 'staff', dueAt: '2026-10-15T00:00:00Z', conversationId: 'c1' },
    { id: 't2', title: 'Gửi JD', assignedTo: 'other', dueAt: '2026-10-14T00:00:00Z', conversationId: null },
    { id: 't3', title: 'Mới quá hạn', assignedTo: 'staff', dueAt: '2026-10-15T02:30:00Z', conversationId: null },
  ];
  assert.deepEqual(evaluateRules({ ...base, rules: [rule('staff', definition)], overdueTasks: tasks }).map((a) => a.dedupeKey), ['rule:r-staff:task:t1']);
  assert.deepEqual(evaluateRules({ ...base, rules: [rule('admin', definition)], overdueTasks: tasks }).map((a) => a.dedupeKey), ['rule:r-admin:task:t2', 'rule:r-admin:task:t1']);
  assert.equal(evaluateRules({ ...base, rules: [rule('staff', definition, { enabled: false })], overdueTasks: tasks }).length, 0);
});

test('stale leads: one summary alert per rule', () => {
  const definition = { trigger: 'LEAD_STALE', days: 2, action: 'PROPOSE_TASK', target: 'OWNER', dueHours: 24 };
  const alerts = evaluateRules({ ...base, rules: [rule('staff', definition)], staleLeads: { 'r-staff': 7 } });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].dedupeKey, 'rule:r-staff:leads');
  assert.equal(alerts[0].proposal.params.title, 'Liên hệ 7 lead mới quá 2 ngày');
  assert.equal(evaluateRules({ ...base, rules: [rule('staff', definition)], staleLeads: { 'r-staff': 0 } }).length, 0);
  assert.equal(evaluateRules({ ...base, rules: [rule('other', definition)], staleLeads: { 'r-other': 5 } }).length, 0, 'owner cannot see contacts');
});

test('each rule opens at most a few alerts per person', () => {
  const definition = { trigger: 'CUSTOMER_WAITING', hours: 1, channels: [], action: 'NOTIFY', target: 'OWNER', dueHours: 2 };
  const many = Array.from({ length: 25 }, (_, index) => waiting({ id: `c${index}`, hours: 2 + index }));
  assert.equal(evaluateRules({ ...base, rules: [rule('staff', definition)], waiting: many }).length, MAX_RULE_ALERTS_PER_RECIPIENT);
});
