import test from 'node:test';
import assert from 'node:assert/strict';
import { activeOptions, codeFromLabel, contentCodePrefix, contentOptionInputSchema, DEFAULT_CONTENT_SETTINGS, findOption, mergeContentSettings, suggestAbbr } from '../src/modules/content/core/content-settings.ts';
import { formatRule } from '../src/modules/content/core/content-prompt.ts';

test('built-ins are there without any row, in the agreed order', () => {
  assert.deepEqual(DEFAULT_CONTENT_SETTINGS.departments.map((item) => item.code), ['REC', 'SALE', 'HR', 'MEDIA', 'NOTICE', 'CTV']);
  assert.equal(findOption(DEFAULT_CONTENT_SETTINGS.formats, 'POST_LONG').abbr, 'DCT');
  assert.deepEqual([findOption(DEFAULT_CONTENT_SETTINGS.formats, 'COMMENT').wordMin, findOption(DEFAULT_CONTENT_SETTINGS.formats, 'COMMENT').wordMax], [10, 30]);
});

test('rows rename, hide, reorder and add entries', () => {
  const settings = mergeContentSettings([
    { kind: 'DEPARTMENT', code: 'REC', label: 'Rec dự án', abbr: 'RD', sort: 9, active: true, word_min: null, word_max: null, guide: null },
    { kind: 'DEPARTMENT', code: 'CTV', label: 'CTV', abbr: 'CTV', sort: 6, active: false, word_min: null, word_max: null, guide: null },
    { kind: 'DEPARTMENT', code: 'AM', label: 'Account Manager', abbr: 'AM', sort: 7, active: true, word_min: null, word_max: null, guide: 'Viết cho khách đang dùng dịch vụ' },
    { kind: 'BOGUS', code: 'X', label: 'x', abbr: null, sort: 1, active: true, word_min: null, word_max: null, guide: null },
  ]);
  assert.equal(settings.departments.at(-1).code, 'REC');
  assert.equal(findOption(settings.departments, 'REC').builtIn, true);
  assert.equal(findOption(settings.departments, 'AM').builtIn, false);
  assert.ok(!activeOptions(settings.departments).some((item) => item.code === 'CTV'));
});

test('content code prefix uses Vietnam date and abbrs', () => {
  const prefix = contentCodePrefix({ date: new Date('2026-10-19T17:30:00Z'), department: 'REC', format: 'POST_LONG', categoryAbbr: 'GT', language: 'VI_JA' }, DEFAULT_CONTENT_SETTINGS);
  assert.equal(prefix, '261020_REC_DCT_GT_VIJA');
  assert.equal(contentCodePrefix({ date: new Date('2026-10-19T03:00:00Z'), department: 'NOTICE', format: 'EMAIL', categoryAbbr: null, language: 'VI' }, DEFAULT_CONTENT_SETTINGS), '261019_TB_MAIL_CHUNG_VI');
});

test('abbr suggestions and new codes drop Vietnamese marks', () => {
  assert.equal(suggestAbbr('Giới thiệu job'), 'GTJ');
  assert.equal(suggestAbbr('Đăng chi tiết'), 'DCT');
  assert.equal(codeFromLabel('Account Manager', 'AM'), 'AM');
  assert.equal(codeFromLabel('Tiếng Hàn', null), 'TIENG_HAN');
  assert.equal(codeFromLabel('3D', '3D'), 'X3D');
});

test('option input: abbr required except styles, formats need a word range', () => {
  const base = { kind: 'DEPARTMENT', code: '', label: 'AM', abbr: 'am', active: true, wordMin: null, wordMax: null, guide: '' };
  assert.equal(contentOptionInputSchema.parse(base).abbr, 'AM');
  assert.equal(contentOptionInputSchema.safeParse({ ...base, abbr: '' }).success, false);
  assert.equal(contentOptionInputSchema.safeParse({ ...base, kind: 'STYLE', abbr: '' }).success, true);
  assert.equal(contentOptionInputSchema.safeParse({ ...base, kind: 'FORMAT', abbr: 'TT' }).success, false);
  assert.equal(contentOptionInputSchema.safeParse({ ...base, kind: 'FORMAT', abbr: 'TT', wordMin: 50, wordMax: 20 }).success, false);
  assert.equal(contentOptionInputSchema.safeParse({ ...base, kind: 'FORMAT', abbr: 'TT', wordMin: 20, wordMax: 50 }).success, true);
});

test('format rule: built-in text, a changed word range wins, new formats use their settings', () => {
  const brief = { contentFormat: 'POST_SHORT', wordRange: [25, 50] };
  assert.ok(!formatRule(brief).includes('ĐỘ DÀI BẮT BUỘC'));
  assert.match(formatRule({ ...brief, wordRange: [40, 70] }), /ĐỘ DÀI BẮT BUỘC: body 40–70 chữ/);
  assert.match(formatRule({ contentFormat: 'TIKTOK', formatLabel: 'Kịch bản TikTok', wordRange: [60, 90], formatGuide: 'Có câu mở 3 giây đầu.' }), /^KỊCH BẢN TIKTOK\. .*60–90 chữ.*Có câu mở 3 giây đầu\.$/);
});
