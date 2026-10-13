import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENAI_RESPONSES_URL, postOpenAIResponse, responseOutputText } from '../src/lib/openai/responses.ts';

function capture() {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response('{}'); } };
}

test('posts JSON to the Responses API with bearer auth', async () => {
  const { calls, fetchImpl } = capture();
  await postOpenAIResponse({ apiKey: 'sk-1', body: { model: 'm', input: 'x' }, fetchImpl });
  assert.equal(calls[0].url, OPENAI_RESPONSES_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, { Authorization: 'Bearer sk-1', 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'm', input: 'x', store: false });
});

test('store is always false, even if a caller asks for true', async () => {
  const { calls, fetchImpl } = capture();
  await postOpenAIResponse({ apiKey: 'k', body: { model: 'm', store: true }, fetchImpl });
  assert.equal(JSON.parse(calls[0].init.body).store, false);
});

test('timeout, redirect and cache are only set when requested', async () => {
  const { calls, fetchImpl } = capture();
  await postOpenAIResponse({ apiKey: 'k', body: {}, fetchImpl });
  await postOpenAIResponse({ apiKey: 'k', body: {}, timeoutMs: 1000, redirect: 'error', cache: 'no-store', fetchImpl });
  assert.equal(calls[0].init.signal, undefined);
  assert.equal(calls[0].init.redirect, undefined);
  assert.ok(calls[1].init.signal instanceof AbortSignal);
  assert.equal(calls[1].init.redirect, 'error');
  assert.equal(calls[1].init.cache, 'no-store');
});

const payload = { output: [
  { content: [{ type: 'output_text', text: 'A' }, { type: 'refusal', text: 'R' }] },
  { type: 'web_search_call' },
  { content: [{ type: 'output_text', text: 'B' }, { type: 'output_text', text: 7 }] },
] };

test('output text: only output_text parts, joined in order', () => {
  assert.equal(responseOutputText(payload), 'AB');
  assert.equal(responseOutputText(payload, { separator: '\n' }), 'A\nB');
});

test('output text: every text part when onlyOutputText is false', () => {
  assert.equal(responseOutputText(payload, { onlyOutputText: false }), 'ARB');
});

test('output text: malformed payloads give an empty string', () => {
  for (const value of [null, undefined, 'x', [], {}, { output: 'x' }, { output: [null, 1, { content: 'x' }] }]) assert.equal(responseOutputText(value), '');
});
