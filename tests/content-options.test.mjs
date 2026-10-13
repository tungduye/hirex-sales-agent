import test from 'node:test';
import assert from 'node:assert/strict';
import { briefInputFromFormData, contentBriefSchema, OTHER_OPTION } from '../src/modules/content/core/content-options.ts';

function form(values) {
  const data = new FormData();
  const base = { jobTitle: 'Java Developer', style: 'PROFESSIONAL', contentLanguage: 'VI_JA', contentFormat: 'EMAIL', department: 'RECRUITING', quantity: '3' };
  for (const [key, value] of Object.entries({ ...base, ...values })) data.set(key, value);
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

test('"Khác" uses the typed text', () => {
  const result = form({ department: OTHER_OPTION, departmentOther: 'Content nội bộ', style: OTHER_OPTION, styleOther: 'Hài hước' });
  assert.equal(result.success, true);
  assert.equal(result.data.department, 'Content nội bộ');
  assert.equal(result.data.style, 'Hài hước');
  assert.equal(form({ department: OTHER_OPTION, departmentOther: ' ' }).success, false);
});

test('rejects bad input', () => {
  for (const values of [{ jobTitle: ' ' }, { contentLanguage: 'FR' }, { contentFormat: 'TWEET' }, { quantity: '0' }, { quantity: '11' }, { quantity: '2.5' }, { style: 'HACK' }, { sampleContent: 'x'.repeat(6001) }]) {
    assert.equal(form(values).success, false, JSON.stringify(values).slice(0, 60));
  }
});
