import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanLink, isStale, locationGroup, mapHeaders, parseJobSheet, parsePriority, parseStatus, parseYesNo, toJobInput } from '../src/modules/jobs/core/job-fields.ts';

test('a job needs vị trí, hướng nghề, công ty và địa điểm; defaults are open and normal', () => {
  const ok = toJobInput({ title: ' BrSE ', careerTrack: 'BrSE', companyName: 'Cty A', location: 'Hà Nội' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.title, 'BrSE');
  assert.equal(ok.value.status, 'OPEN');
  assert.equal(ok.value.priority, 'NORMAL');
  assert.equal(ok.value.companyNamePublic, true);
  assert.deepEqual(toJobInput({ title: 'x', location: 'y' }), { ok: false, error: 'Thiếu Hướng nghề, Công ty.' });
});
test('bad codes, links, statuses and priorities are refused with a reason', () => {
  const base = { title: 'x', careerTrack: 'x', companyName: 'x', location: 'x' };
  assert.equal(toJobInput({ ...base, code: 'J 01' }).ok, false);
  assert.match(toJobInput({ ...base, jdLink: 'javascript:alert(1)' }).error, /Link JD/);
  assert.match(toJobInput({ ...base, status: 'abc' }).error, /Trạng thái/);
  assert.match(toJobInput({ ...base, priority: 'gấp' }).error, /Ưu tiên/);
  assert.equal(cleanLink('https://drive.google.com/x'), 'https://drive.google.com/x');
});
test('Vietnamese words for status, priority and yes/no are understood', () => {
  assert.equal(parseStatus('Đang tuyển'), 'OPEN');
  assert.equal(parseStatus('tạm dừng'), 'PAUSED');
  assert.equal(parseStatus('Đã đóng'), 'CLOSED');
  assert.equal(parsePriority('Cao'), 'HIGH');
  assert.equal(parseYesNo('Không', true), false);
  assert.equal(parseYesNo('', true), true);
});
test('an Excel sheet maps headers without accents and reports bad rows by Excel row number', () => {
  assert.deepEqual(mapHeaders(['Vi tri', 'CÔNG TY', 'lạ']), ['title', 'companyName', null]);
  const rows = [
    ['Mã job', 'Vị trí', 'Hướng nghề', 'Công ty', 'Địa điểm', 'Trạng thái', 'Được nói tên công ty'],
    ['J-1', 'BrSE', 'BrSE', 'Cty A', 'Hà Nội', 'Đang tuyển', 'Không'],
    [null, null, null, null, null, null, null],
    ['J-2', 'PM', '', 'Cty B', 'HCM', '', ''],
  ];
  const result = parseJobSheet(rows);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].companyNamePublic, false);
  assert.deepEqual(result.problems, [{ row: 4, error: 'Thiếu Hướng nghề.' }]);
  assert.match(parseJobSheet([['a', 'b'], ['1', '2']]).problems[0].error, /file mẫu/);
});
test('areas group common spellings; jobs over 30 days old are stale', () => {
  assert.equal(locationGroup('Mễ Trì Hạ, Hà Nội'), 'Hà Nội');
  assert.equal(locationGroup('TP HCM'), 'HCM');
  assert.equal(locationGroup('Tokyo'), 'Nhật');
  assert.equal(isStale(new Date(Date.now() - 31 * 86400000).toISOString(), Date.now()), true);
  assert.equal(isStale(new Date().toISOString(), Date.now()), false);
});
