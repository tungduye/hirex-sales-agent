import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeTitle, scoreDraft, titleLead, wordCount } from '../src/modules/content/core/content-quality.ts';

test('title lead: place and position, Japanese style for JA', () => {
  assert.equal(titleLead({ location: 'Cầu Giấy, Hà Nội', position: 'BrSE Java', japanese: false }), '[HÀ NỘI] BRSE JAVA');
  assert.equal(titleLead({ location: 'Tokyo', position: 'BrSE', japanese: true }), '【Tokyo】BrSE');
  assert.equal(titleLead({ location: null, position: null, japanese: false }), null);
});

test('final title: lead first, no repeat, all capitals', () => {
  const lead = '[HÀ NỘI] BRSE JAVA';
  assert.equal(finalizeTitle('[Hà Nội] BrSE Java – lương 50–65M, N2', lead, false), '[HÀ NỘI] BRSE JAVA – LƯƠNG 50–65M, N2');
  assert.equal(finalizeTitle('Lương tới 65M cho BrSE có N2', lead, false), '[HÀ NỘI] BRSE JAVA – LƯƠNG TỚI 65M CHO BRSE CÓ N2');
  assert.equal(finalizeTitle('[HCM] BrSE Java: onsite 3 tháng', lead, false), '[HÀ NỘI] BRSE JAVA – ONSITE 3 THÁNG');
  assert.equal(finalizeTitle('【大阪】BrSE 年収600万', '【Tokyo】BrSE', true), '【Tokyo】BrSE – 年収600万');
  assert.equal(finalizeTitle('Team building quý 3', null, false), 'TEAM BUILDING QUÝ 3');
});

test('word count handles Japanese roughly', () => {
  assert.equal(wordCount('Một hai ba, bốn!'), 4);
  assert.ok(wordCount('日本語の求人です') >= 3);
});

test('score prefers the right length and less similarity', () => {
  const body = (n) => Array.from({ length: n }, () => 'chữ').join(' ');
  const input = { wordRange: [80, 120], languageCount: 1, isComment: false };
  const good = scoreDraft({ title: '[HÀ NỘI] BRSE JAVA – LƯƠNG 50M', body: body(100), similarity: 0.1 }, input);
  const long = scoreDraft({ title: '[HÀ NỘI] BRSE JAVA – LƯƠNG 50M', body: body(220), similarity: 0.1 }, input);
  const close = scoreDraft({ title: '[HÀ NỘI] BRSE JAVA – LƯƠNG 50M', body: body(100), similarity: 0.45 }, input);
  assert.ok(good > long && good > close);
});
