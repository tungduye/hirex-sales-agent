import assert from 'node:assert/strict';
import test from 'node:test';
import { plainStatus, retrieveEvidence, validateCitations } from '../src/modules/human-documents/core/retrieval.ts';

const docs = [
  { id: 1, name: 'Quy trình đào tạo', group: 'Vận hành', status: '<p>Nhân viên tham gia đào tạo vào thứ hai.</p>' },
  { id: 2, name: 'Lịch họp', group: 'R&D', status: '<p>Nhóm nghiên cứu họp vào thứ tư.</p>' },
];
test('retrieves Vietnamese queries without accents and respects selected scope', () => {
  assert.equal(retrieveEvidence(docs, 'dao tao')[0].id, 1);
  assert.deepEqual(retrieveEvidence(docs, 'đào tạo', 999), []);
  assert.ok(retrieveEvidence(docs, 'tóm tắt', 2).every(item => item.id === 2));
  assert.deepEqual(retrieveEvidence(docs, 'xyzunknown'), []);
});
test('removes executable HTML and bounds context size', () => {
  assert.equal(plainStatus('<script>alert(1)</script><p>Nội dung</p>'), 'Nội dung');
  const result = retrieveEvidence([{ ...docs[0], status: 'Nội dung mẫu '.repeat(10000) }], 'tóm tắt', 1);
  assert.ok(result.length <= 8);
  assert.ok(result.every(item => item.text.length <= 2000));
});
test('rejects missing, fabricated and cross-document citations', () => {
  const evidence = retrieveEvidence(docs, 'đào tạo');
  const quote = 'Nhân viên tham gia đào tạo vào thứ hai.';
  assert.equal(validateCitations([{ id: 1, quote }], evidence), true);
  assert.equal(validateCitations([], evidence), false);
  assert.equal(validateCitations([{ id: 2, quote }], evidence), false);
  assert.equal(validateCitations([{ id: 1, quote: 'Nội dung không có thật trong tài liệu.' }], evidence), false);
});
