import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, PAGE_KEYS, canOpenPage, openablePages, pageLink } from '../src/modules/assistant/core/page-links.ts';
import { parseToolCall, toolsFor } from '../src/modules/assistant/core/assistant-tools.ts';

const member = { permissions: ['dashboard.view', 'contacts.view', 'inbox.view', 'content.view'], isAdmin: false };
const admin = { permissions: [], isAdmin: true };

test('mo_trang only links pages the member can open', () => {
  assert.equal(pageLink('LIEN_HE', {}, member).link, '/contacts');
  assert.match(pageLink('CHIEN_DICH_EMAIL', {}, member).loi, /chưa có quyền/);
  assert.match(pageLink('TAI_LIEU', {}, member).loi, /chưa có quyền/);
  assert.equal(pageLink('TAI_LIEU', { tu_khoa: 'quy trình' }, admin).link, '/documents?q=quy+tr%C3%ACnh');
  assert.ok(openablePages(member).includes('HO_CHUA'));
  assert.ok(!openablePages(member).includes('VAI_TRO'));
  for (const key of PAGE_KEYS) assert.match(PAGES[key].path, /^\/[a-z/-]*$/);
  assert.equal(canOpenPage('AI_RECRUITER', { permissions: ['roles.manage'], isAdmin: false }), false);
});

test('mo_trang applies the filters each page understands', () => {
  assert.equal(pageLink('LIEN_HE', { tu_khoa: 'Lan', trang_thai: 'qualified' }, member).link, '/contacts?q=Lan&status=QUALIFIED');
  assert.equal(pageLink('HO_CHUA', { kenh: 'ZALO' }, member).link, '/inbox/all?channel=ZALO');
  assert.equal(pageLink('KHO_CONTENT', { dinh_dang: 'POST_SHORT', bo_phan: 'SALE', ngon_ngu: 'VI_JA' }, member).link, '/content?format=POST_SHORT&dept=SALE&lang=VI_JA');
  const ignored = pageLink('CONG_VIEC', { tu_khoa: 'abc' }, { permissions: ['tasks.view'], isAdmin: false });
  assert.equal(ignored.link, '/tasks');
  assert.deepEqual(ignored.bo_loc_khong_ap_dung, ['tu_khoa']);
  // Unknown status is not passed to the page.
  assert.equal(pageLink('LIEN_HE', { trang_thai: 'HOT' }, member).link, '/contacts');
});

test('phase 2 read tools follow their permissions', () => {
  const names = (permissions, isAdmin = false) => toolsFor(permissions, isAdmin).map((tool) => tool.name);
  assert.ok(names([]).includes('mo_trang'));
  assert.ok(!names([]).includes('chi_tiet_lien_he'));
  assert.ok(names(['contacts.view']).includes('chi_tiet_lien_he'));
  assert.ok(names(['companies.view']).includes('chi_tiet_cong_ty'));
  assert.ok(names(['campaigns.view']).includes('chi_tiet_chien_dich'));
  assert.ok(names(['content.view']).includes('doc_content') && names(['content.view']).includes('content_chua_dung'));
  assert.ok(!names(['roles.manage']).includes('thanh_vien_vai_tro'));
  assert.ok(names(['roles.view']).includes('thanh_vien_vai_tro'));
});

test('phase 2 tool arguments are validated', () => {
  const tools = toolsFor(['contacts.view', 'campaigns.view', 'content.view'], false);
  const nulls = { tu_khoa: null, trang_thai: null, kenh: null, dinh_dang: null, bo_phan: null, ngon_ngu: null };
  assert.equal(parseToolCall('mo_trang', JSON.stringify({ trang: 'LIEN_HE', ...nulls }), tools).ok, true);
  assert.equal(parseToolCall('mo_trang', JSON.stringify({ trang: 'TRANG_LA', ...nulls }), tools).ok, false);
  assert.equal(parseToolCall('chi_tiet_lien_he', JSON.stringify({ contact_id: 'abc' }), tools).ok, false);
  assert.equal(parseToolCall('chi_tiet_chien_dich', JSON.stringify({ campaign_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', kenh: null }), tools).ok, true);
  assert.equal(parseToolCall('content_chua_dung', JSON.stringify({ dinh_dang: 'POST_SHORT', bo_phan: null, ngon_ngu: null, so_luong: 99 }), tools).ok, false);
});

test('instructions explain details, page links and missing scan data', async () => {
  const { assistantInstructions } = await import('../src/modules/assistant/core/assistant-instructions.ts');
  const text = assistantInstructions({ fullName: null, now: new Date('2026-10-16T03:00:00Z'), toolLabels: [], context: null });
  assert.match(text, /chi_tiet_lien_he/);
  assert.match(text, /gọi mo_trang/);
  assert.match(text, /chưa lưu kết quả Scan CV/);
});
