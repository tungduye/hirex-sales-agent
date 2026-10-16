import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changedFields } from '../src/modules/assistant/core/crm-changes.ts';
import { ASSISTANT_TOOLS, parseToolCall, toolsFor } from '../src/modules/assistant/core/assistant-tools.ts';

const FIELDS = [{ arg: 'ho_ten', column: 'full_name', label: 'Họ tên', required: true }, { arg: 'chuc_danh', column: 'job_title', label: 'Chức danh' }, { arg: 'email', column: 'email', label: 'Email' }];

test('changedFields: null keeps, "" clears, same value is not a change', () => {
  const row = { full_name: 'Lan', job_title: 'BrSE', email: null };
  assert.deepEqual(changedFields(row, { ho_ten: null, chuc_danh: null, email: null }, FIELDS), { list: [] });
  assert.deepEqual(changedFields(row, { ho_ten: ' Lan ', chuc_danh: 'BrSE', email: null }, FIELDS), { list: [] });
  assert.deepEqual(changedFields(row, { ho_ten: null, chuc_danh: '', email: 'lan@x.vn' }, FIELDS).list, [
    { column: 'job_title', label: 'Chức danh', before: 'BrSE', after: null },
    { column: 'email', label: 'Email', before: null, after: 'lan@x.vn' },
  ]);
  assert.match(changedFields(row, { ho_ten: '', chuc_danh: null, email: null }, FIELDS).error, /không được để trống/);
});

test('CRM proposal tools follow their permissions and only create cards', () => {
  const names = (permissions) => toolsFor(permissions, false).map((tool) => tool.name);
  assert.ok(names(['contacts.create']).includes('de_xuat_tao_lien_he'));
  assert.ok(!names(['contacts.view']).includes('de_xuat_tao_lien_he'));
  assert.ok(names(['contacts.update']).includes('de_xuat_sua_lien_he') && names(['contacts.update']).includes('de_xuat_ghi_chu_lien_he'));
  assert.ok(names(['companies.create']).includes('de_xuat_tao_cong_ty'));
  assert.ok(names(['companies.update']).includes('de_xuat_sua_cong_ty'));
  assert.ok(names(['tasks.update']).includes('de_xuat_cap_nhat_cong_viec'));
  assert.ok(!names(['tasks.view']).includes('de_xuat_cap_nhat_cong_viec'));
  for (const tool of ASSISTANT_TOOLS.filter((item) => item.name.startsWith('de_xuat_'))) assert.equal(tool.proposal, true, tool.name);
  assert.ok(!ASSISTANT_TOOLS.some((tool) => /xoa|delete/i.test(tool.name)), 'no delete tool');
});

test('CRM proposal arguments are validated', () => {
  const tools = toolsFor(['contacts.create', 'contacts.update', 'tasks.update'], false);
  const contact = { ho_ten: 'Lan', chuc_danh: null, email: null, sdt: null, cong_ty: null, quoc_gia: null, nguon: null, trang_thai_lead: null };
  assert.equal(parseToolCall('de_xuat_tao_lien_he', JSON.stringify(contact), tools).ok, true);
  assert.equal(parseToolCall('de_xuat_tao_lien_he', JSON.stringify({ ...contact, ho_ten: '' }), tools).ok, false);
  assert.equal(parseToolCall('de_xuat_tao_lien_he', JSON.stringify({ ...contact, trang_thai_lead: 'HOT' }), tools).ok, false);
  const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
  assert.equal(parseToolCall('de_xuat_cap_nhat_cong_viec', JSON.stringify({ task_id: id, trang_thai: 'COMPLETED', han: null, giao_cho: null, tieu_de: null }), tools).ok, true);
  assert.equal(parseToolCall('de_xuat_cap_nhat_cong_viec', JSON.stringify({ task_id: id, trang_thai: 'DELETED', han: null, giao_cho: null, tieu_de: null }), tools).ok, false);
  assert.equal(parseToolCall('de_xuat_ghi_chu_lien_he', JSON.stringify({ contact_id: id, noi_dung: 'x'.repeat(5001) }), tools).ok, false);
});

test('every CRM action kind has a permission, a builder and an executor', () => {
  const source = readFileSync(new URL('../src/modules/assistant/server/assistant-proposals.ts', import.meta.url), 'utf8');
  for (const kind of ['CREATE_CONTACT', 'UPDATE_CONTACT', 'ADD_NOTE', 'CREATE_COMPANY', 'UPDATE_COMPANY', 'UPDATE_TASK']) {
    assert.match(source, new RegExp(`${kind}: "[a-z]+\\.[a-z]+"`), `${kind} permission`);
    assert.match(source, new RegExp(`${kind}: execute`), `${kind} executor`);
  }
  const migration = readFileSync(new URL('../supabase/migrations/083_assistant_crm_actions.sql', import.meta.url), 'utf8');
  for (const kind of ['CREATE_CONTACT', 'UPDATE_CONTACT', 'ADD_NOTE', 'CREATE_COMPANY', 'UPDATE_COMPANY', 'UPDATE_TASK']) assert.ok(migration.includes(`'${kind}'`), kind);
});
