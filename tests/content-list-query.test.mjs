import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_PAGE_SIZE, contentListHref, contentSearchPattern, normalizeContentListQuery } from '../src/modules/content/core/content-list-query.ts';

test('content list URL state', () => {
  assert.deepEqual(normalizeContentListQuery({}), { q: '', language: 'ALL', format: 'ALL', department: 'ALL', category: 'ALL', page: 1, pageSize: CONTENT_PAGE_SIZE });
  assert.deepEqual(normalizeContentListQuery({ q: ' CT-0001 ', lang: 'vi_ja', format: 'post', dept: 'hr', page: '2' }), { q: 'CT-0001', language: 'VI_JA', format: 'POST_LONG', department: 'HR', category: 'ALL', page: 2, pageSize: CONTENT_PAGE_SIZE });
  assert.equal(normalizeContentListQuery({ lang: 'f r', format: 'x', page: '-1' }).language, 'ALL');
  assert.equal(contentListHref({ q: 'java dev', language: 'EN', format: 'ALL', department: 'SALE', page: 3 }), '/content?q=java+dev&lang=EN&dept=SALE&page=3');
  assert.equal(contentListHref({ q: '', language: 'ALL', format: 'ALL', department: 'ALL', page: 1 }), '/content');
  assert.equal(contentSearchPattern('a,b(c)'), '*a*b*c*');
  assert.equal(contentSearchPattern(' % '), null);
});

import { batchStatus, isBatchRunning, STALE_BATCH_MS } from '../src/modules/content/core/batch-status.ts';

test('batch status text', () => {
  const now = Date.parse('2026-10-13T10:00:00Z');
  const base = { id: 'b', jobTitle: 'Java', quantity: 3, savedCount: 0, rejectedCount: 0, errorCode: null, createdAt: '2026-10-13T09:59:00Z' };
  assert.equal(batchStatus({ ...base, status: 'PENDING' }, now).tone, 'running');
  assert.equal(isBatchRunning({ status: 'PENDING', createdAt: new Date(now - STALE_BATCH_MS - 1).toISOString() }, now), false);
  assert.equal(batchStatus({ ...base, status: 'PENDING', createdAt: new Date(now - STALE_BATCH_MS - 1).toISOString() }, now).tone, 'error');
  assert.equal(batchStatus({ ...base, status: 'COMPLETED', savedCount: 3 }, now).text, 'Đã lưu 3/3 content.');
  assert.match(batchStatus({ ...base, status: 'PARTIAL', savedCount: 2, rejectedCount: 1 }, now).text, /1 content bị loại/);
  assert.match(batchStatus({ ...base, status: 'FAILED', errorCode: 'ALL_TOO_SIMILAR' }, now).text, /trùng quá 50%/);
  assert.match(batchStatus({ ...base, status: 'FAILED', errorCode: 'WEIRD' }, now).text, /Không tạo được/);
});
