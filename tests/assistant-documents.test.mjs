import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANT_TOOLS, parseToolCall, toolsFor } from '../src/modules/assistant/core/assistant-tools.ts';
import { assistantInstructions } from '../src/modules/assistant/core/assistant-instructions.ts';
import { runAssistant, serializeToolOutput } from '../src/modules/assistant/core/assistant-loop.ts';
import { DOCUMENT_PART_CHARS, readDocument, searchDocuments, snippetAround } from '../src/modules/human-documents/core/assistant-documents.ts';

const docs = [
  { id: 1, name: 'Quy trình tuyển dụng IT', group: 'Bộ phận: Tuyển dụng', folderPath: ['Tuyển dụng', 'Quy trình'], status: '<p>Bước 1: sàng lọc CV.</p><p>Bước 2: phỏng vấn kỹ thuật với trưởng nhóm.</p>' },
  { id: 2, name: 'Chính sách lương thưởng', group: 'Nhân sự', status: '<p>Thưởng tháng 13 trả vào tháng 1. Lương xét lại mỗi năm.</p>' },
  { id: 3, name: 'Hướng dẫn Zalo', group: 'Sale', status: '<p>Kết bạn Zalo trước khi gửi tin.</p>' },
  { id: 4, name: 'Tài liệu dài', group: 'Sale', status: `<p>${'a'.repeat(DOCUMENT_PART_CHARS + 500)}</p>` },
  { id: 5, name: 'Trống', group: 'Sale', status: '' },
];

test('document tools: "Tài liệu · Xem" (admins always), and only when "Tài liệu" is switched on', () => {
  const names = (perms, admin, documents) => toolsFor(perms, admin, { documents }).map((tool) => tool.name).filter((name) => /tai_lieu/.test(name));
  assert.deepEqual(names(['roles.manage', 'settings.view'], false, true), []);
  assert.deepEqual(names([], true, false), []);
  assert.deepEqual(names([], true, undefined), []);
  assert.deepEqual(names([], true, true), ['tim_tai_lieu', 'doc_tai_lieu', 'hoi_tai_lieu']);
  assert.deepEqual(names(['documents.view'], false, true), ['tim_tai_lieu', 'doc_tai_lieu', 'hoi_tai_lieu']);
  assert.deepEqual(names(['documents.view'], false, false), []);
  for (const tool of ASSISTANT_TOOLS.filter((item) => item.documents)) {
    assert.equal(tool.permission, 'documents.view');
    assert.ok(!tool.proposal, 'document tools only read');
  }
  // No tool deletes anything.
  assert.ok(!ASSISTANT_TOOLS.some((tool) => /xoa|delete/i.test(tool.name)));
});

test('document tool arguments are validated', () => {
  const tools = toolsFor([], true, { documents: true });
  assert.equal(parseToolCall('doc_tai_lieu', JSON.stringify({ document_id: 3, tu_khoa: null, phan: null }), tools).ok, true);
  assert.equal(parseToolCall('doc_tai_lieu', JSON.stringify({ document_id: -1, tu_khoa: null, phan: null }), tools).ok, false);
  assert.equal(parseToolCall('hoi_tai_lieu', JSON.stringify({ cau_hoi: 'a', document_id: null }), tools).ok, false);
  assert.equal(parseToolCall('tim_tai_lieu', JSON.stringify({ tu_khoa: 'zalo', nhom: null }), toolsFor([], true)).ok, false);
});

test('searchDocuments ranks by name, folder and content without accents', () => {
  const result = searchDocuments(docs, 'phong van ky thuat', null);
  assert.equal(result.tai_lieu[0].id, 1);
  assert.equal(result.tai_lieu[0].link, '/documents?id=1');
  assert.equal(result.tai_lieu[0].thu_muc, 'Tuyển dụng / Quy trình');
  assert.match(result.tai_lieu[0].doan_khop, /phỏng vấn kỹ thuật/);
  assert.equal(searchDocuments(docs, 'thưởng tháng 13', null).tai_lieu[0].id, 2);
  assert.equal(searchDocuments(docs, 'không tồn tại xyz', null).so_khop, 0);
  // Group filter (group name or folder).
  assert.deepEqual(searchDocuments(docs, null, 'sale').tai_lieu.map((item) => item.id).sort(), [3, 4, 5]);
  assert.deepEqual(searchDocuments(docs, null, 'quy trinh').tai_lieu.map((item) => item.id), [1]);
  // No keyword: library overview with groups.
  const overview = searchDocuments(docs, null, null);
  assert.equal(overview.tong_tai_lieu, 5);
  assert.equal(overview.tong_nhom, 3);
  assert.deepEqual(overview.nhom[0], { ten: 'Sale', so_tai_lieu: 3 });
});

test('readDocument reads by part or by keyword', () => {
  assert.match(readDocument(docs, 99, null, null).loi, /#99/);
  const first = readDocument(docs, 4, null, null);
  assert.equal(first.so_phan, 2);
  assert.equal(first.noi_dung_tai_lieu.length, DOCUMENT_PART_CHARS);
  assert.match(first.ghi_chu, /phan=2/);
  const second = readDocument(docs, 4, 9, null);
  assert.equal(second.phan, 2);
  assert.equal(second.ghi_chu, undefined);
  const byKeyword = readDocument(docs, 1, null, 'phỏng vấn');
  assert.equal(byKeyword.cach_doc, 'doan_lien_quan');
  assert.match(byKeyword.noi_dung_tai_lieu[0], /phỏng vấn/);
  assert.equal(readDocument(docs, 5, null, null).so_phan, 0);
});

test('snippetAround keeps original accents around the match', () => {
  const text = `${'x '.repeat(200)}Đường dẫn quan trọng ở đây ${'y '.repeat(200)}`;
  const snippet = snippetAround(text, ['duong', 'dan'], 20);
  assert.match(snippet, /Đường dẫn/);
  assert.ok(snippet.startsWith('…') && snippet.endsWith('…'));
});

test('instructions explain the document switch', () => {
  const base = { fullName: 'An', now: new Date('2026-10-15T08:00:00Z'), toolLabels: [], context: null };
  assert.match(assistantInstructions({ ...base, documents: 'on' }), /tim_tai_lieu/);
  assert.match(assistantInstructions({ ...base, documents: 'off' }), /chưa bật nút "Tài liệu"/);
  assert.match(assistantInstructions(base), /chỉ dành cho người được cấp quyền/);
});

test('document tools may return longer output', async () => {
  assert.equal(serializeToolOutput({ t: 'x'.repeat(13000) }, 14000).includes('đã cắt bớt'), false);
  const tools = toolsFor([], true, { documents: true });
  const outputs = [];
  let round = 0;
  await runAssistant({ question: 'q', history: [], tools, deps: {
    async callModel(input) {
      round++;
      if (round === 1) return { text: '', calls: [{ call_id: 'c1', name: 'doc_tai_lieu', arguments: JSON.stringify({ document_id: 4, tu_khoa: null, phan: null }) }], inputTokens: 0, outputTokens: 0 };
      outputs.push(...input.filter((item) => item.type === 'function_call_output'));
      return { text: 'ok', calls: [], inputTokens: 0, outputTokens: 0 };
    },
    runTool: async () => ({ noi_dung_tai_lieu: 'z'.repeat(13000) }),
  } });
  assert.equal(outputs[0].output.includes('đã cắt bớt'), false);
});

test('a link written inside bold stays clickable', async () => {
  const { parseInline } = await import('../src/modules/assistant/core/assistant-markdown.ts');
  assert.deepEqual(parseInline('Đã đọc **[150926_Quy trình](/documents?id=5774)** xong'), [
    { type: 'text', text: 'Đã đọc ' },
    { type: 'link', text: '150926_Quy trình', href: '/documents?id=5774' },
    { type: 'text', text: ' xong' },
  ]);
  assert.deepEqual(parseInline('**Nguồn: [A](/documents?id=1)**'), [{ type: 'bold', text: 'Nguồn: ' }, { type: 'link', text: 'A', href: '/documents?id=1' }]);
  assert.deepEqual(parseInline('**đậm**'), [{ type: 'bold', text: 'đậm' }]);
});

test('search matches word starts and needs every word of a short query', () => {
  const library = [
    { id: 1, name: 'Quy trình tuyển dụng', group: 'HR', status: '' },
    { id: 2, name: 'Quyền lợi nhân viên', group: 'HR', status: '<p>tuyển dụng nội bộ</p>' },
    { id: 3, name: 'JD lập trình viên', group: 'HR', status: '<p>Quy trình phỏng vấn</p>' },
  ];
  assert.deepEqual(searchDocuments(library, 'quy trình tuyển dụng', null).tai_lieu.map((item) => item.id), [1]);
  assert.deepEqual(searchDocuments(library, 'quy trình', null).tai_lieu.map((item) => item.id), [1, 3]);
});

test('questions without a system tool search the documents first', () => {
  const base = { fullName: 'An', now: new Date('2026-10-16T02:00:00Z'), toolLabels: [], context: null };
  const on = assistantInstructions({ ...base, documents: 'on' });
  assert.match(on, /PHẢI gọi tim_tai_lieu/);
  assert.match(on, /theo tài liệu <tên>/);
  assert.match(assistantInstructions({ ...base, documents: 'off' }), /số lượng|bộ phận tự báo cáo/);
});
