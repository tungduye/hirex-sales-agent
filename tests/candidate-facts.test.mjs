import test from 'node:test';
import assert from 'node:assert/strict';
import { editedFacts, factChanges, factPromptInput, foldFact } from '../src/modules/rec-flow/core/candidate-facts.ts';
import { FACT_FIELDS, flowSummary, EMPTY_FLOW } from '../src/modules/rec-flow/core/rec-flow.ts';

const lines = [
  { id: 'm1', direction: 'OUTBOUND', text: 'Hiện anh đang quan tâm hướng PM, BrSE hay Developer hơn ạ?', at: '2026-10-23T04:30:00Z' },
  { id: 'm2', direction: 'INBOUND', text: 'BrsE em nhé', at: '2026-10-23T04:40:00Z' },
  { id: 'm3', direction: 'INBOUND', text: 'Anh N2, từng ở Nhật 5 năm. Lương 60tr được không em?', at: '2026-10-23T04:41:00Z' },
];

test('a value is filed only with a quote from a new candidate message', () => {
  const raw = { facts: [
    { key: 'careerTrack', value: 'BrSE', quote: 'BrsE em nhé' },
    { key: 'japaneseLevel', value: 'N2', quote: 'anh n2' },
    { key: 'expectedSalary', value: '60tr', quote: 'Lương 60tr' },
    { key: 'location', value: 'Hà Nội', quote: 'anh ở Hà Nội' },
    { key: 'experience', value: 'PM', quote: 'quan tâm hướng PM' },
    { key: 'nonsense', value: 'x', quote: 'BrsE' },
  ] };
  const changes = factChanges(raw, lines, '2026-10-23T04:35:00Z', {});
  assert.deepEqual(changes.map((item) => [item.key, item.value, item.messageId]), [['careerTrack', 'BrSE', 'm2'], ['japaneseLevel', 'N2', 'm3'], ['expectedSalary', '60tr', 'm3']]);
});

test('only what changed is filed, with the previous value', () => {
  const raw = { facts: [{ key: 'careerTrack', value: 'brse', quote: 'BrsE em nhé' }, { key: 'expectedSalary', value: '60tr', quote: 'Lương 60tr được không' }] };
  const changes = factChanges(raw, lines, null, { careerTrack: 'BrSE', expectedSalary: '55tr' });
  assert.deepEqual(changes, [{ key: 'expectedSalary', value: '60tr', previous: '55tr', quote: 'Lương 60tr được không', messageId: 'm3' }]);
});

test('messages read before are context, not new', () => {
  assert.equal(factChanges({ facts: [{ key: 'careerTrack', value: 'BrSE', quote: 'BrsE em nhé' }] }, lines, '2026-10-23T04:40:30Z', {}).length, 0);
  const input = JSON.parse(factPromptInput(lines, '2026-10-23T04:40:30Z', { location: 'Hà Nội' }));
  assert.equal(input.TIN_MOI.length, 1);
  assert.equal(input.TIN_TRUOC.length, 2);
  assert.deepEqual(input.DA_BIET, { location: 'Hà Nội' });
  assert.match(input.TIN_TRUOC[0], /^RECRUITER:/);
});

test('member edits are compared without case or marks', () => {
  assert.deepEqual(editedFacts({ careerTrack: 'BrSE', location: 'Hà Nội' }, { careerTrack: 'brse', location: 'HCM', phone: '0901' }),
    [{ key: 'location', value: 'HCM', previous: 'Hà Nội' }, { key: 'phone', value: '0901', previous: null }]);
  assert.equal(foldFact('Hà  Nội!'), 'ha noi');
});

test('the new fields are there, the bar shows only the main ones', () => {
  for (const key of ['phone', 'email', 'currentCompany', 'currentTitle', 'skills', 'noticePeriod', 'appliedCompanies', 'cvStatus']) assert.ok(FACT_FIELDS.some((field) => field.key === key), key);
  const summary = flowSummary({ ...EMPTY_FLOW, facts: { careerTrack: 'BrSE', phone: '0901234567' } });
  assert.deepEqual(summary.known, ['Hướng nghề: BrSE']);
});
