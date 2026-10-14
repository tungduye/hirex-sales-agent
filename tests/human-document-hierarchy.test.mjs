import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentTree, documentFolderPath } from '../src/modules/human-documents/core/hierarchy.ts';
import { parseHumanFolders } from '../src/modules/human-documents/core/api-snapshot.ts';

test('roots follow Human VH1 VH2 VH3 while child and document order stays intact', () => {
  const roots = [2, 3, 1].map(n => `Vận Hành ${n} (VH${n})_Tên`);
  const folderPaths = roots.flatMap(root => [[root, 'B'], [root, 'A']]);
  const docs = folderPaths.map((folderPath, i) => ({ id: i + 1, name: 'Doc', group: folderPath[1], folderPath }));
  const tree = buildDocumentTree(docs, folderPaths);
  assert.deepEqual(tree.map(n => n.name), [roots[2], roots[0], roots[1]]);
  for (const root of tree) assert.deepEqual(root.children.map(n => n.name), ['B', 'A']);
  assert.deepEqual(tree[0].children[0].documents.map(d => d.id), [5]);
});

test('API parent IDs override legacy guesses and retain server folder order', () => {
  const folders = parseHumanFolders({code:200,data:[
    {masterId:1,masterName:'Root',parent:null}, {masterId:2,masterName:'New department',parent:1},
    {masterId:3,masterName:'New subject',parent:2},
  ]});
  const tree = buildDocumentTree([{id:9,name:'Report',group:'New subject',folderPath:folders.paths.get(3)}],folders.order.map(id=>folders.paths.get(id)));
  assert.equal(tree[0].children[0].children[0].documents[0].id,9);
  assert.equal(tree.length,1);
});
test('invalid parent graph cannot replace a valid snapshot', () => {
  assert.throws(()=>parseHumanFolders({code:200,data:[{masterId:1,masterName:'A',parent:2}]}));
  assert.throws(()=>parseHumanFolders({code:200,data:[{masterId:1,masterName:'A',parent:1}]}));
});
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
