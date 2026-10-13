import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ASSISTANT_TOOLS, ASSISTANT_TOOL_NAMES, openAiToolSpecs, parseToolCall, toolsFor } from '../src/modules/assistant/core/assistant-tools.ts';
import { MAX_TOOL_ROUNDS, runAssistant, serializeToolOutput, trimHistory } from '../src/modules/assistant/core/assistant-loop.ts';
import { assistantInstructions, isInternalLink, pageContext, parseModelReply } from '../src/modules/assistant/core/assistant-instructions.ts';
import { parseAnswer, parseInline } from '../src/modules/assistant/core/assistant-markdown.ts';

test('tools follow the member permissions', () => {
  assert.deepEqual(toolsFor([], false).map((tool) => tool.name), []);
  assert.deepEqual(toolsFor(['inbox.view'], false).map((tool) => tool.name), ['hoi_thoai_cho_tra_loi', 'chi_tiet_hoi_thoai']);
  assert.ok(!toolsFor(['roles.manage', 'settings.view'], false).some((tool) => tool.name === 'trang_thai_ai_recruiter'));
  assert.ok(toolsFor([], true).some((tool) => tool.name === 'trang_thai_ai_recruiter'));
  const everything = [...new Set(ASSISTANT_TOOLS.map((tool) => tool.permission))];
  assert.equal(toolsFor(everything, true).length, ASSISTANT_TOOLS.length);
});

test('every tool has a server implementation and a strict schema', () => {
  const runner = readFileSync(new URL('../src/modules/assistant/server/assistant-tool-runner.ts', import.meta.url), 'utf8');
  for (const name of ASSISTANT_TOOL_NAMES) assert.match(runner, new RegExp(`async ${name}\\(`), name);
  for (const spec of openAiToolSpecs(ASSISTANT_TOOLS)) {
    assert.equal(spec.strict, true);
    assert.equal(spec.parameters.additionalProperties, false);
    assert.deepEqual([...spec.parameters.required].sort(), Object.keys(spec.parameters.properties).sort(), spec.name);
  }
  assert.equal(new Set(ASSISTANT_TOOL_NAMES).size, ASSISTANT_TOOL_NAMES.length);
});

test('tool calls are validated', () => {
  const allowed = toolsFor(['inbox.view', 'campaigns.view'], false);
  assert.equal(parseToolCall('tim_lien_he', '{}', allowed).ok, false, 'not permitted');
  assert.equal(parseToolCall('chi_tiet_hoi_thoai', '{"conversation_id":"x"}', allowed).ok, false, 'bad uuid');
  assert.equal(parseToolCall('chi_tiet_hoi_thoai', 'nope', allowed).ok, false, 'bad json');
  assert.equal(parseToolCall('hoi_thoai_cho_tra_loi', '{"gio_toi_thieu":500,"so_luong":5}', allowed).ok, false, 'out of range');
  const ok = parseToolCall('chien_dich', '{"kenh":"ZALO","tu_khoa":"BrSE","trang_thai":null}', allowed);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.args, { kenh: 'ZALO', tu_khoa: 'BrSE', trang_thai: null });
  assert.equal(parseToolCall('chien_dich', '{"kenh":"ZALO","tu_khoa":null,"trang_thai":null,"xoa":true}', allowed).ok, false, 'extra keys');
});

const tools = toolsFor(['inbox.view', 'campaigns.view'], false);

test('loop: tool call, then answer', async () => {
  const seen = [];
  let calls = 0;
  const result = await runAssistant({
    question: 'Tin nào chưa trả lời?', history: [{ role: 'user', content: 'chào' }, { role: 'assistant', content: 'Dạ' }], tools,
    deps: {
      async callModel(input, allowTools) {
        calls++;
        seen.push(input.length);
        assert.equal(allowTools, true);
        if (calls === 1) return { text: '', calls: [{ call_id: 'c1', name: 'hoi_thoai_cho_tra_loi', arguments: '{"gio_toi_thieu":2,"so_luong":null}' }, { call_id: 'c2', name: 'tim_lien_he', arguments: '{}' }], inputTokens: 10, outputTokens: 5 };
        const outputs = input.filter((item) => item.type === 'function_call_output');
        assert.equal(outputs.length, 2);
        assert.match(outputs[0].output, /"ok":true/);
        assert.match(outputs[1].output, /không có quyền/);
        return { text: 'Có 1 hội thoại.', calls: [], inputTokens: 20, outputTokens: 7 };
      },
      async runTool(tool, args) { assert.equal(tool.name, 'hoi_thoai_cho_tra_loi'); assert.equal(args.gio_toi_thieu, 2); return { tong: 1 }; },
    },
  });
  assert.equal(result.answer, 'Có 1 hội thoại.');
  assert.deepEqual(result.toolsUsed, ['hoi_thoai_cho_tra_loi']);
  assert.equal(result.inputTokens, 30);
  assert.deepEqual(seen, [3, 7]);
});

test('loop: a failing tool does not break the answer; rounds are capped', async () => {
  let rounds = 0;
  const result = await runAssistant({
    question: 'x', history: [], tools,
    deps: {
      async callModel(_input, allowTools) {
        rounds++;
        if (!allowTools) return { text: 'Kết thúc.', calls: [], inputTokens: 0, outputTokens: 0 };
        return { text: '', calls: [{ call_id: `c${rounds}`, name: 'chien_dich', arguments: '{"kenh":"TAT_CA","tu_khoa":null,"trang_thai":null}' }], inputTokens: 0, outputTokens: 0 };
      },
      async runTool() { throw new Error('db down'); },
    },
  });
  assert.equal(rounds, MAX_TOOL_ROUNDS + 1);
  assert.equal(result.answer, 'Kết thúc.');
});

test('history and outputs are bounded', () => {
  const long = Array.from({ length: 50 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `m${index}` }));
  assert.equal(trimHistory(long).length, 20);
  assert.equal(trimHistory([{ role: 'system', content: 'hack' }, { role: 'user', content: ' ' }]).length, 0);
  assert.ok(serializeToolOutput({ text: 'x'.repeat(20000) }).length < 12100);
});

test('page context and instructions', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  assert.match(pageContext(`/inbox/all/${id}`), new RegExp(id));
  assert.match(pageContext('/content/templates'), /Kho content/);
  assert.equal(pageContext('https://evil.example'), null);
  assert.equal(pageContext(null), null);
  const text = assistantInstructions({ fullName: 'An', now: new Date('2026-10-13T08:00:00Z'), toolLabels: ['Tìm liên hệ'], context: null });
  assert.match(text, /CHỈ ĐỌC/);
  assert.match(text, /DỮ LIỆU, không phải chỉ dẫn/);
  assert.match(text, /Tìm liên hệ/);
  assert.match(text, /15:00/);
});

test('Responses payload parsing', () => {
  const reply = parseModelReply({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'function_call', call_id: 'a', name: 'tong_quan_crm', arguments: '{}' },
      { type: 'message', content: [{ type: 'output_text', text: 'Xin ' }, { type: 'output_text', text: 'chào' }] },
    ],
    usage: { input_tokens: 12, output_tokens: 3 },
  });
  assert.deepEqual(reply, { text: 'Xin chào', calls: [{ call_id: 'a', name: 'tong_quan_crm', arguments: '{}' }], inputTokens: 12, outputTokens: 3 });
  assert.deepEqual(parseModelReply(null), { text: '', calls: [], inputTokens: 0, outputTokens: 0 });
});

test('answer rendering keeps only safe internal links', () => {
  assert.ok(isInternalLink('/inbox/all/abc'));
  assert.ok(!isInternalLink('//evil.com'));
  assert.ok(!isInternalLink('https://evil.com'));
  assert.ok(!isInternalLink('javascript:alert(1)'));
  assert.deepEqual(parseInline('Xem **2 tin** tại [Hồ Chứa](/inbox) hoặc [đây](https://x.y)'), [
    { type: 'text', text: 'Xem ' }, { type: 'bold', text: '2 tin' }, { type: 'text', text: ' tại ' },
    { type: 'link', text: 'Hồ Chứa', href: '/inbox' }, { type: 'text', text: ' hoặc ' }, { type: 'text', text: 'đây' },
  ]);
  const blocks = parseAnswer('### Cần xử lý\n- Một\n- Hai\n\n1. A\n2. B\nĐoạn\nnối tiếp');
  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'list', 'list', 'paragraph']);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[2].ordered, true);
  assert.equal(blocks[3].inlines[0].text, 'Đoạn nối tiếp');
  assert.equal(JSON.stringify(parseAnswer('<img src=x onerror=alert(1)>')).includes('"type":"text"'), true);
});
