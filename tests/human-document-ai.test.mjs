import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';
import * as retrieval from '../src/modules/human-documents/core/retrieval.ts';
import * as openai from '../src/lib/openai/responses.ts';
function loadSummaryBatchBuilder() {
  const output = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('src/modules/human-documents/core/summary-batches.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports: output.exports, require: () => ({ plainStatus: html => html.replace(/<[^>]*>/g, '').trim() }) });
  return output.exports.buildFolderSummaryBatches;
}
const buildFolderSummaryBatches = loadSummaryBatchBuilder();
const quote = 'Nhóm nghiên cứu họp vào thứ tư hàng tuần.';
function load({ denied = false, fetcher, snapshot, folderResolver } = {}) {
  const output = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('src/modules/human-documents/server/ask-documents.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports: output.exports, require: name => {
    if (name === 'zod') return zod;
    if (name.includes('access-control')) return { requireWorkspaceAdmin: async () => { if (denied) throw Error('FORBIDDEN'); return { workspaceId: 'test', userId: 'test' }; } };
    if (name === './snapshot') return { loadHumanSnapshot: async () => snapshot ?? ({ importedAt: '2026-10-12', documents: [] }) };
    if (name === '../core/local-query') return { localDocumentQuery: () => null };
    if (name === '../core/hierarchy') return { documentsForFolderQuery: folderResolver ?? (() => null) };
    if (name === '../core/summary-batches') return { buildFolderSummaryBatches };
    if (name === '@/lib/openai/responses') return { responseOutputText: openai.responseOutputText, postOpenAIResponse: request => openai.postOpenAIResponse({ ...request, fetchImpl: fetcher }) };
    return { retrieveEvidence: () => [{ id: 1, name: 'Tài liệu thử nghiệm', text: quote }], validateCitations: retrieval.validateCitations };
  }, process: { env: { OPENAI_API_KEY: 'synthetic-test-key' } }, fetch: fetcher, AbortSignal, Map, Date });
  return output.exports.askDocuments;
}
const response = (id = 1) => ({ ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ answer: 'Họp thứ tư.', supported: true, citations: [{ id, quote }] }) }] }] }) });
test('authorization and consent block upstream calls', async () => {
  const fetcher = () => { throw Error('must not call'); };
  await assert.rejects(load({ denied: true, fetcher })({ question: 'Lịch họp', consent: true }), /FORBIDDEN/);
  assert.equal((await load({ fetcher })({ question: 'Lịch họp', consent: false })).error, true);
});
test('request is bounded, nonstored, structured and sources are validated', async () => {
  const ask = load({ fetcher: async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.properties.citations.maxItems, 8);
    assert.equal(options.redirect, 'error');
    return response();
  } });
  assert.equal((await ask({ question: 'Lịch họp', consent: true })).sources[0].id, 1);
  assert.equal((await load({ fetcher: async () => response(999) })({ question: 'Lịch họp', consent: true })).sources.length, 0);
});
test('provider failures are redacted', async () => {
  const result = await load({ fetcher: async () => { throw Error('secret upstream error'); } })({ question: 'Lịch họp', consent: true });
  assert.equal(result.error, true);
  assert.ok(!result.answer.includes('secret'));
});
test('summary retries once with exact-copy citation guidance before refusing', async () => {
  let calls = 0;
  const ask = load({ fetcher: async () => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ answer: 'Không đủ thông tin.', supported: false, citations: [] }) }] }] }) };
    return response();
  } });
  const result = await ask({ question: 'Tóm tắt các nội dung chính của tài liệu đang mở', selectedId: 1, consent: true });
  assert.equal(calls, 2);
  assert.equal(result.sources[0].id, 1);
});

test('folder summary sends every document status in bounded, lossless batches', () => {
  const documents = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    name: `Tài liệu ${index + 1}`,
    group: 'Thư mục thử nghiệm',
    status: `<p>${String(index + 1).padStart(2, '0')} ${'nội dung đầy đủ '.repeat(700)}</p>`,
  }));
  documents[4].status = '<p></p>';
  const result = buildFolderSummaryBatches({ documents, maxChunkCharacters: 1200, maxBatchCharacters: 4000 });

  assert.equal(result.documentsWithContent, 24);
  assert.equal(result.documentsWithoutContent, 1);
  assert.equal(new Set(result.evidence.map(item => item.id)).size, 24);
  assert.ok(result.batches.length > 1);
  assert.ok(result.batches.every(batch => batch.reduce((sum, item) => sum + item.text.length, 0) <= 4000));
  for (const document of documents.filter(item => item.id !== 5)) {
    const reconstructed = result.evidence.filter(item => item.id === document.id).map(item => item.text).join('');
    assert.equal(reconstructed, document.status.replace(/<[^>]*>/g, '').trim());
  }
});

test('folder summary sends all 25 statuses through batch summaries and validates final citations', async () => {
  const documents = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1, name: `Tài liệu ${index + 1}`, group: 'Môn thử nghiệm', status: `<p>Ý chính tài liệu ${index + 1}. ${'Thông tin đã được xác nhận. '.repeat(40)}</p>`,
  }));
  const snapshot = { importedAt: '2026-10-12', documents };
  const folderResolver = () => ({ name: 'Thư mục thử nghiệm', documents });
  const batchInputs = [];
  let finalInput;
  const fetcher = async (_, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.input);
    if (body.instructions.includes('một lô trong quá trình')) {
      batchInputs.push(input);
      const source = input.evidence[0];
      const quote = source.text.slice(0, 80);
      return responseWith({ answer: `Ý chính từ ${source.name}.`, supported: true, citations: [{ id: source.id, quote }] });
    }
    finalInput = input;
    const citation = input.batchSummaries[0].citations[0];
    return responseWith({ answer: 'Tổng hợp từ các lô.', supported: true, citations: [citation] });
  };
  const result = await load({ snapshot, folderResolver, fetcher })({ question: 'Tổng hợp thư mục thử nghiệm', consent: true });

  assert.ok(batchInputs.length > 1);
  assert.deepEqual([...new Set(batchInputs.flatMap(input => input.evidence.map(item => item.id)))].sort((a, b) => a - b), documents.map(item => item.id));
  assert.equal(finalInput.batchSummaries.length, batchInputs.length);
  assert.equal(result.sources[0].id, 1);
  assert.match(result.answer, /Tổng hợp từ các lô/);
});

function responseWith(result) {
  return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }) };
}
