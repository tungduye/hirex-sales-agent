import test from 'node:test';
import assert from 'node:assert/strict';
import { briefForModel, composeBrief, vietnamDate } from '../src/modules/assistant/core/daily-brief.ts';

const now = new Date('2026-10-14T03:00:00Z'); // 10:00 in Vietnam
const conv = (name, hours, extra = {}) => ({ name, channel: 'ZALO', account: 'Linh', hours, group: false, link: `/inbox/all/${name}`, ...extra });

test('vietnam date rolls over at 17:00 UTC', () => {
  assert.equal(vietnamDate(new Date('2026-10-14T16:59:00Z')), '2026-10-14');
  assert.equal(vietnamDate(new Date('2026-10-14T17:00:00Z')), '2026-10-15');
});

test('only sections the member may see appear; failures are reported', () => {
  const brief = composeBrief({ now, tasks: { open: [] }, channels: null });
  assert.deepEqual(brief.ok.map((item) => item.area), ['tasks']);
  assert.deepEqual(brief.failed, ['channels']);
  assert.equal(brief.items.length, 0);
  assert.equal(brief.date, '2026-10-14');
});

test('waiting conversations: groups are left out, long waits are urgent', () => {
  const calm = composeBrief({ now, inbox: { waiting: [conv('An', 3), conv('Nhóm IT', 30, { group: true })] } });
  assert.equal(calm.items[0].severity, 'medium');
  assert.match(calm.items[0].title, /^1 hội thoại chờ/);
  assert.equal(calm.items[0].link, '/inbox/all/An', 'single conversation links straight to it');
  assert.ok(calm.items[0].details.some((line) => /Chưa tính 1 nhóm chat/.test(line)));
  const urgent = composeBrief({ now, inbox: { waiting: [conv('An', 3), conv('Bình', 50)] } });
  assert.equal(urgent.items[0].severity, 'high');
  assert.match(urgent.items[0].details[0], /^Bình .* chờ 2 ngày$/, 'longest wait first');
  const onlyGroups = composeBrief({ now, inbox: { waiting: [conv('Nhóm', 9, { group: true })] } });
  assert.equal(onlyGroups.items.length, 0);
  assert.match(onlyGroups.ok[0].text, /chỉ có 1 nhóm chat/);
});

test('channels, email worker, campaigns, tasks and AI Recruiter rules', () => {
  const brief = composeBrief({
    now,
    channels: { problems: [{ channel: 'FACEBOOK', name: 'Page A', reason: 'TOKEN_EXPIRED' }], gmailProblems: [] },
    emailWorker: { state: 'STALE' },
    campaigns: { running: [
      { name: 'Ổn', channel: 'EMAIL', sent: 500, failed: 2, link: '/campaigns/1' },
      { name: 'Lỗi', channel: 'EMAIL', sent: 40, failed: 10, link: '/campaigns/2' },
      { name: 'Zalo', channel: 'ZALO', sent: 10, failed: null, link: '/campaigns/omnichannel/3' },
    ] },
    tasks: { open: [
      { title: 'Quá hạn', dueAt: '2026-10-13T10:00:00Z', link: '/tasks' },
      { title: 'Hôm nay', dueAt: '2026-10-14T09:00:00Z', link: '/tasks' },
      { title: 'Mai', dueAt: '2026-10-15T09:00:00Z', link: '/tasks' },
      { title: 'Không hạn', dueAt: null, link: '/tasks' },
    ] },
    aiRecruiter: { errors: { MODEL_TIMEOUT: 3, X: 0 } },
  });
  const titles = brief.items.map((item) => `${item.severity}:${item.area}:${item.title}`);
  assert.deepEqual(titles, [
    'high:channels:1 tài khoản kết nối đang lỗi hoặc mất kết nối',
    'high:email_worker:Bộ gửi chiến dịch email có thể đã dừng (hơn 10 phút chưa chạy)',
    'high:tasks:1 công việc của anh/chị đã quá hạn',
    'medium:tasks:1 công việc đến hạn hôm nay',
    'medium:campaigns:Chiến dịch “Lỗi” có tỷ lệ lỗi cao',
    'medium:ai_recruiter:AI Recruiter gặp 3 lỗi trong 24 giờ qua',
  ]);
  assert.match(brief.items[0].details[0], /Facebook Page · Page A — TOKEN_EXPIRED/);
});

test('everything fine gives no items, only reassurance', () => {
  const brief = composeBrief({ now, inbox: { waiting: [] }, channels: { problems: [], gmailProblems: [] }, emailWorker: { state: 'HEALTHY' }, campaigns: { running: [] }, tasks: { open: [] }, aiRecruiter: { errors: {} } });
  assert.equal(brief.items.length, 0);
  assert.equal(brief.ok.length, 6);
  const model = briefForModel(brief);
  assert.equal(model.can_xu_ly.length, 0);
  assert.equal(model.on_dinh.length, 6);
});

test('long lists are capped', () => {
  const brief = composeBrief({ now, inbox: { waiting: Array.from({ length: 12 }, (_, index) => conv(`K${index}`, 3 + index)) } });
  assert.equal(brief.items[0].severity, 'high', '10 or more waiting is urgent');
  assert.equal(brief.items[0].details.length, 6);
  assert.match(brief.items[0].details[5], /và 7 mục khác/);
});
