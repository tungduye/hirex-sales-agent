import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentTree, matchesFilter, NO_CATEGORY, pathKeys } from '../src/modules/content/core/content-tree.ts';

const lists = {
  departments: [{ code: 'REC', label: 'Tuyển dự án', active: true }, { code: 'SALE', label: 'Sale', active: true }, { code: 'CTV', label: 'CTV', active: false }],
  formats: [{ code: 'POST_LONG', label: 'Đăng chi tiết' }, { code: 'COMMENT', label: 'Comment' }],
  categories: [{ id: 'gt', department: 'SALE', name: 'Giới thiệu', active: true, sort: 1 }, { id: 'old', department: 'SALE', name: 'Cũ', active: false, sort: 2 }],
};
const entries = [
  { department: 'REC', categoryId: null, format: 'POST_LONG' },
  { department: 'REC', categoryId: null, format: null },
  { department: 'SALE', categoryId: 'gt', format: 'COMMENT' },
  { department: 'AM', categoryId: null, format: 'POST_LONG' },
];

test('tree: departments › categories › formats with counts', () => {
  const tree = buildContentTree(entries, lists);
  assert.deepEqual(tree.map((node) => [node.key, node.count]), [['REC', 2], ['SALE', 1], ['AM', 1]], 'hidden empty departments left out, unknown codes kept');
  assert.deepEqual(tree[0].children.map((node) => node.label), ['Chưa phân loại']);
  assert.deepEqual(tree[0].children[0].children.map((node) => [node.label, node.count]), [['Đăng chi tiết', 2]], 'no format counts as Đăng chi tiết');
  assert.deepEqual(tree[1].children.map((node) => node.label), ['Giới thiệu'], 'empty hidden category left out');
  assert.equal(tree[1].children[0].children[0].filter.format, 'COMMENT');
});

test('filters and opened path', () => {
  assert.equal(matchesFilter(entries[0], { department: 'REC', category: NO_CATEGORY }), true);
  assert.equal(matchesFilter(entries[2], { department: 'SALE', category: 'gt', format: 'POST_LONG' }), false);
  assert.deepEqual(pathKeys({ department: 'SALE', category: 'gt', format: 'COMMENT' }), ['SALE', 'SALE/gt']);
});
