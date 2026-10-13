import test from 'node:test';
import assert from 'node:assert/strict';
import { briefInputFromFormData, contentBriefSchema, contentTemplateSchema, OTHER_OPTION, templateInputFromFormData } from '../src/modules/content/core/content-options.ts';

function form(values) {
  const data = new FormData();
  const base = { jobTitle: 'Java Developer', style: 'PROFESSIONAL', contentLanguage: 'VI_JA', contentFormat: 'POST', department: 'REC', quantity: '3' };
  for (const [key, value] of Object.entries({ ...base, ...values })) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item); else data.set(key, value);
  }
  return contentBriefSchema.safeParse(briefInputFromFormData(data));
}

test('valid brief with presets', () => {
  const result = form({ salary: '  2000 USD ', position: '' });
  assert.equal(result.success, true);
  assert.equal(result.data.salary, '2000 USD');
  assert.equal(result.data.position, null);
  assert.equal(result.data.style, 'PROFESSIONAL');
  assert.equal(result.data.quantity, 3);
});

test('"Khác" style uses the typed text; departments are the four fixed ones', () => {
  const result = form({ style: OTHER_OPTION, styleOther: 'Hài hước', department: 'CTV' });
  assert.equal(result.success, true);
  assert.equal(result.data.style, 'Hài hước');
  assert.equal(result.data.department, 'CTV');
  for (const department of ['REC', 'HR', 'SALE', 'CTV']) assert.equal(form({ department }).success, true, department);
  for (const department of ['RECRUITING', 'OTHER', '']) assert.equal(form({ department }).success, false, department);
});

test('template ids: valid uuids, de-duplicated, at most 5', () => {
  const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  assert.deepEqual(form({ templateId: [id(1), id(1), id(2)] }).data.templateIds, [id(1), id(2)]);
  assert.equal(form({ templateId: [1, 2, 3, 4, 5, 6].map(id) }).success, false);
  assert.equal(form({ templateId: ['nope'] }).success, false);
  assert.deepEqual(form({}).data.templateIds, []);
});

test('template form', () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ department: 'SALE', language: 'JA', weight: '7', body: ' Mẫu ', active: 'on' })) data.set(key, value);
  const result = contentTemplateSchema.safeParse(templateInputFromFormData(data));
  assert.equal(result.success, true);
  assert.equal(result.data.weight, 7);
  assert.equal(result.data.active, true);
  assert.equal(result.data.body, 'Mẫu');
  data.set('weight', '11');
  assert.equal(contentTemplateSchema.safeParse(templateInputFromFormData(data)).success, false);
});

test('rejects bad input', () => {
  for (const values of [{ jobTitle: ' ' }, { contentLanguage: 'FR' }, { contentFormat: 'TWEET' }, { jdText: 'x'.repeat(8001) }, { quantity: '0' }, { quantity: '11' }, { quantity: '2.5' }, { style: 'HACK' }, { sampleContent: 'x'.repeat(6001) }]) {
    assert.equal(form(values).success, false, JSON.stringify(values).slice(0, 60));
  }
});
