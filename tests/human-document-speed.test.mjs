import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { VersionCache } from '../src/modules/human-documents/core/version-cache.ts';
import * as retrieval from '../src/modules/human-documents/core/retrieval.ts';
import { documentsForFolderQuery } from '../src/modules/human-documents/core/hierarchy.ts';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/modules/human-documents/core/local-query.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: () => retrieval });
const query = exports.localDocumentQuery;
const docs = [{ id: 1, name: 'Hướng dẫn CRM', group: 'Môn_Trang R&D', status: '<p>Hướng dẫn thao tác hệ thống CRM.</p>' }, { id: 2, name: 'Báo cáo tuần', group: 'Môn_Toản R&D', status: '' }];
test('local queries are scoped and ambiguous conditions fall back', () => {
  assert.equal(query(docs, 'Liệt kê tài liệu của Trang R&D').sources[0].id, 1);
  assert.equal(query(docs, 'Đếm tài liệu').sources.length, 0);
  assert.match(query(docs, 'Đếm tài liệu', 1).answer, /Có 1 tài liệu/);
  assert.equal(query(docs, 'Liệt kê tài liệu của Trang R&D không có CRM'), null);
  assert.equal(query(docs, 'Giải thích nội dung CRM'), null);
  assert.equal(query(docs, 'Liệt kê tài liệu của R&D'), null);
  assert.equal(query(docs, 'Tìm tài liệu tên CRM').sources.length, 1);
});
test('prepared index reuses array identity but not another snapshot', () => {
  assert.equal(retrieval.documentIndex(docs), retrieval.documentIndex(docs));
  assert.notEqual(retrieval.documentIndex([...docs]), retrieval.documentIndex(docs));
  assert.equal(retrieval.retrieveEvidence(docs, 'CRM')[0].id, 1);
});
test('cache isolates workspace, invalidates versions and shares concurrent loads', async () => {
  const cache = new VersionCache(); let calls = 0;
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get('A', '1', load), cache.get('A', '1', load)]), [1, 1]);
  assert.equal(await cache.get('B', '1', load), 2);
  assert.equal(await cache.get('A', '2', load), 3);
  cache.delete('A'); assert.equal(await cache.get('A', '2', load), 4);
});
test('failed cache loads are never reused', async () => {
  const cache = new VersionCache();
  await assert.rejects(cache.get('A', '1', async () => { throw Error('fail'); }));
  assert.equal(await cache.get('A', '1', async () => 7), 7);
});
test('folder summary queries resolve an ancestor and include every confirmed child group', () => {
  const result = documentsForFolderQuery([
    { id: 1, name: 'Trang doc', group: 'Môn_Trang R&D' },
    { id: 2, name: 'Toan doc', group: 'Môn_Toản R&D' },
    { id: 3, name: 'Other', group: 'Môn_BC02_R&D_VH1_Tuần_Mar' },
  ], 'BC03_R&D');
  assert.equal(result.name, 'Đề tài_BC03_R&D_VH1');
  assert.deepEqual(result.documents.map(doc => doc.id), [1, 2]);
  assert.equal(documentsForFolderQuery([
    { id: 1, name: 'Trang doc', group: 'Môn_Trang R&D', status: '' },
    { id: 2, name: 'Toan doc', group: 'Môn_Toản R&D', status: '' },
  ], 'all Đề tài_BC03_R&D_VH1').name, 'Đề tài_BC03_R&D_VH1');
});
test('BC03 R&D folder resolution includes normalized groups and nested descendants', () => {
  const result = documentsForFolderQuery([
    { id: 1, name: 'Trang', group: 'Môn_Trang R&D ' },
    { id: 2, name: 'Trang task', group: 'Môn_Trang R&D_Task' },
    { id: 3, name: 'Toản', group: 'Môn_Toản R&D' },
    { id: 4, name: 'Tùng', group: 'Môn_Tùng Leader R&D' },
    { id: 5, name: 'Khác', group: 'Môn_BC02_R&D_VH1_Tuần' },
  ], 'BC03_R&D');
  assert.deepEqual(result.documents.map(doc => doc.id), [1, 2, 3, 4]);
});
test('folder summaries sample several documents before taking more chunks per document', () => {
  const docs = [1, 2, 3].map(id => ({ id, name: `Doc ${id}`, group: 'R&D', status: 'needle '.repeat(5000) }));
  const excerpts = retrieval.retrieveEvidence(docs, 'needle', undefined, { limit: 5, maxPerDocument: 2 });
  assert.deepEqual([...new Set(excerpts.map(item => item.id))], [1, 2, 3]);
});
