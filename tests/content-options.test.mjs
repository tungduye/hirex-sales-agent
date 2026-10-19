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

test('"Khác" style uses the typed text; departments are codes (the list itself lives in Cài đặt Kho content)', () => {
  const result = form({ style: OTHER_OPTION, styleOther: 'Hài hước', department: 'CTV' });
  assert.equal(result.success, true);
  assert.equal(result.data.style, 'Hài hước');
  assert.equal(result.data.department, 'CTV');
  for (const department of ['REC', 'HR', 'SALE', 'CTV', 'MEDIA', 'NOTICE']) assert.equal(form({ department }).success, true, department);
  assert.equal(form({ department: 'AM' }).success, true, 'a department added in settings');
  for (const department of ['rec', '1REC', 'R E C', '']) assert.equal(form({ department }).success, false, department);
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
  for (const values of [{ jobTitle: ' ' }, { contentLanguage: 'fr' }, { contentFormat: 'tweet!' }, { jdText: 'x'.repeat(8001) }, { quantity: '0' }, { quantity: '11' }, { quantity: '2.5' }, { style: 'hack me' }, { sampleContent: 'x'.repeat(6001) }]) {
    assert.equal(form(values).success, false, JSON.stringify(values).slice(0, 60));
  }
});

test('taxonomy: new formats, legacy format codes, Japanese, optional category', () => {
  for (const contentFormat of ['EMAIL', 'POST_LONG', 'POST_MEDIUM', 'POST_SHORT', 'COMMENT']) assert.equal(form({ contentFormat }).success, true, contentFormat);
  assert.equal(form({ contentFormat: 'ESSAY_100' }).data.contentFormat, 'POST_MEDIUM');
  assert.equal(form({ contentFormat: 'SUMMARY_50' }).data.contentFormat, 'POST_SHORT');
  assert.equal(form({ contentFormat: 'STORY' }).data.contentFormat, 'POST_LONG');
  assert.equal(form({ contentLanguage: 'JA' }).success, true);
  assert.equal(form({}).data.categoryId, null);
  assert.equal(form({ categoryId: '00000000-0000-4000-8000-000000000001' }).data.categoryId, '00000000-0000-4000-8000-000000000001');
  assert.equal(form({ categoryId: 'abc' }).success, false);
  const data = new FormData();
  for (const [key, value] of Object.entries({ department: 'MEDIA', language: 'EN_JA', contentFormat: 'COMMENT', body: 'x' })) data.set(key, value);
  const template = contentTemplateSchema.safeParse(templateInputFromFormData(data));
  assert.equal(template.success, true);
  assert.equal(template.data.contentFormat, 'COMMENT');
  assert.equal(template.data.categoryId, null);
});

test('campaign text from library content', async () => {
  const { messageTextOf, emailHtmlOf } = await import('../src/modules/content/core/campaign-content.ts');
  assert.equal(messageTextOf({ title: ' [HN] BrSE ', body: ' Thân bài ', content_format: 'POST_SHORT' }), '[HN] BrSE\n\nThân bài');
  assert.equal(messageTextOf({ title: 'nhãn', body: ' Hay quá anh ơi ', content_format: 'COMMENT' }), 'Hay quá anh ơi');
  assert.equal(emailHtmlOf('Chào <anh>,\nDòng 2\n\nĐoạn 2 & hết'), '<p>Chào &lt;anh&gt;,<br>Dòng 2</p><p>Đoạn 2 &amp; hết</p>');
});
