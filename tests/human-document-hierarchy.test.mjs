import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentTree, documentFolderPath } from '../src/modules/human-documents/core/hierarchy.ts';
test('R&D subjects use the confirmed four-level ancestry, not VH parsing', () => {
  const path = documentFolderPath('Môn_Trang R&D');
  assert.equal(path.length, 4);
  assert.ok(path[1].startsWith('Bộ phận_BC03'));
  assert.equal(path[2], 'Đề tài_BC03_R&D_VH1');
  assert.equal(documentFolderPath('Unknown_VH2')[0], 'Chưa xác định thư mục cha');
});
test('a folder contains direct documents and child folders with no duplicates', () => {
  const entries = [{ id: 1, name: 'Direct', group: 'Đề tài_BC03_ Ban Hỗ Trợ (BHT)_VH1' }, { id: 2, name: 'Nested', group: 'Môn_BC03_Ban Hỗ Trợ (BHT)_VH1' }];
  const tree = buildDocumentTree(entries);
  const topic = tree[0].children[0].children[0];
  assert.equal(topic.documents[0].id, 1);
  assert.equal(topic.children[0].documents[0].id, 2);
  assert.equal(tree.length, 1);
});
