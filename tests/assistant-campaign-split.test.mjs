import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseNameOf, campaignNames, divideSenders, splitEvenly } from '../src/modules/assistant/core/campaign-split.ts';
import { parseToolCall, toolsFor } from '../src/modules/assistant/core/assistant-tools.ts';

test('splitEvenly keeps file order and sizes differ by at most one', () => {
  assert.deepEqual(splitEvenly(10, 3), [{ from: 0, to: 4 }, { from: 4, to: 7 }, { from: 7, to: 10 }]);
  assert.deepEqual(splitEvenly(9, 3).map((range) => range.to - range.from), [3, 3, 3]);
  assert.deepEqual(splitEvenly(5, 1), [{ from: 0, to: 5 }]);
  const ranges = splitEvenly(20000, 7);
  assert.equal(ranges.at(-1).to, 20000);
  assert.ok(Math.max(...ranges.map((r) => r.to - r.from)) - Math.min(...ranges.map((r) => r.to - r.from)) <= 1);
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i].from, ranges[i - 1].to, 'no gaps or overlaps');
  assert.throws(() => splitEvenly(2, 3), /TOO_FEW_ROWS/);
  assert.throws(() => splitEvenly(10, 0), /PARTS/);
});

test('divideSenders gives each campaign its own mailboxes', () => {
  assert.deepEqual(divideSenders(['a', 'b', 'c', 'd', 'e'], 3), [['a', 'd'], ['b', 'e'], ['c']]);
  const groups = divideSenders(['a', 'b', 'c'], 3);
  assert.equal(new Set(groups.flat()).size, 3, 'no mailbox in two campaigns');
  assert.throws(() => divideSenders(['a', 'b'], 3), /TOO_FEW_SENDERS/);
});

test('campaign names', () => {
  assert.deepEqual(campaignNames('MKT Tháng 10', 3), ['MKT Tháng 10 — Phần 1/3', 'MKT Tháng 10 — Phần 2/3', 'MKT Tháng 10 — Phần 3/3']);
  assert.deepEqual(campaignNames('  ', 1), ['Chiến dịch']);
  assert.ok(campaignNames('x'.repeat(300), 2)[0].length <= 200);
  assert.equal(baseNameOf('data_van_anh.xlsx'), 'data van anh');
});

test('campaign proposal tool: permission and arguments', () => {
  assert.ok(toolsFor(['campaigns.create'], false).some((tool) => tool.name === 'de_xuat_tao_chien_dich_email'));
  assert.ok(!toolsFor(['campaigns.view', 'campaigns.update'], false).some((tool) => tool.name === 'de_xuat_tao_chien_dich_email'));
  const tools = toolsFor(['campaigns.create'], false);
  const base = { upload_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', so_chien_dich: 3, ten_chien_dich: null, hop_mail_cua: 'Vân Anh', nguoi_phu_trach: null, ma_content: [], bo_phan: null, ngon_ngu: null };
  assert.equal(parseToolCall('de_xuat_tao_chien_dich_email', JSON.stringify(base), tools).ok, true);
  assert.equal(parseToolCall('de_xuat_tao_chien_dich_email', JSON.stringify({ ...base, so_chien_dich: 11 }), tools).ok, false);
  assert.equal(parseToolCall('de_xuat_tao_chien_dich_email', JSON.stringify({ ...base, hop_mail_cua: '' }), tools).ok, false);
});

test('only drafts: the executor never launches and the kind is allowed by migration 084', () => {
  const source = readFileSync(new URL('../src/modules/assistant/server/assistant-proposals-campaigns.ts', import.meta.url), 'utf8');
  assert.match(source, /status: "DRAFT"/);
  assert.ok(!/status: "(RUNNING|SCHEDULED)"/.test(source), 'never schedules or starts');
  assert.ok(readFileSync(new URL('../supabase/migrations/084_assistant_uploads.sql', import.meta.url), 'utf8').includes("'CREATE_EMAIL_CAMPAIGNS'"));
  const proposals = readFileSync(new URL('../src/modules/assistant/server/assistant-proposals.ts', import.meta.url), 'utf8');
  assert.match(proposals, /CREATE_EMAIL_CAMPAIGNS: "campaigns\.create"/);
});
