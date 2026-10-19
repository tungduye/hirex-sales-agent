import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHolaResult, draftKept, jobOverview, offerMissing, readyForOffer, EMPTY_FLOW, flowSummary, HOLA_RESULT_SCHEMA, careTaskTitle, holaInstructions, holeInstructions, jobsForPrompt, OUTCOME_TAGS, REC_OUTCOMES, mergeFacts, normalizeFlow, splitParts } from '../src/modules/rec-flow/core/rec-flow.ts';

const J1 = '11111111-1111-4111-8111-111111111111', J2 = '22222222-2222-4222-8222-222222222222', J3 = '33333333-3333-4333-8333-333333333333';
const job = (id, code, location, track, extra = {}) => ({ id, code, title: `${track} job`, careerTrack: track, companyName: `Cty ${code}`, companyNamePublic: true, location,
  workMode: null, japaneseLevelMin: 'N2', experienceMin: null, salaryRange: '30-40M', sellingPoints: null, summary: null, requirements: null, jdLink: null, interviewProcess: null, priority: 'NORMAL', ...extra });

test('stored states are cleaned: bad steps, unknown facts and bad job ids are dropped', () => {
  const state = normalizeFlow({ step: 12, facts: { careerTrack: '  BrSE ', password: 'x', location: '' }, offeredJobIds: [J1, 'nope', J1], rejectedJobs: [{ jobId: J2, reason: 'xa' }, { jobId: 'x' }], outcome: 'HACK' });
  assert.deepEqual(state, { step: 1, facts: { careerTrack: 'BrSE' }, offeredJobIds: [J1], rejectedJobs: [{ jobId: J2, reason: 'xa' }], outcome: null });
});
test('the bar says the step, what is known and what is missing', () => {
  const summary = flowSummary(normalizeFlow({ step: 4, facts: { careerTrack: 'BrSE', location: 'Hà Nội' } }));
  assert.equal(summary.stepLabel, 'Bước 4/8');
  assert.equal(summary.stepName, 'Tìm hiểu ứng viên');
  assert.deepEqual(summary.known, ['Hướng nghề: BrSE', 'Khu vực: Hà Nội']);
  assert.deepEqual(summary.missing, ['tiếng Nhật', 'kinh nghiệm', 'ưu tiên khi chuyển hoặc lương mong muốn']);
  assert.equal(summary.offered, 0);
  assert.deepEqual(flowSummary(normalizeFlow({ step: 6, facts: { careerTrack: 'BrSE' }, offeredJobIds: [J1] })).missing, []);
});
test('facts only fill or correct, never erase', () => {
  assert.deepEqual(mergeFacts({ careerTrack: 'BrSE', location: 'HN' }, { location: 'Hà Nội', careerTrack: null, japaneseLevel: 'N2' }), { careerTrack: 'BrSE', location: 'Hà Nội', japaneseLevel: 'N2' });
});
test('jobs for the prompt: same area and track first, offered/rejected left out, hidden company names stay hidden', () => {
  const jobs = [job(J1, 'HCM_1', 'Hồ Chí Minh', 'BrSE'), job(J2, 'HN_1', 'Mễ Trì, Hà Nội', 'BrSE', { companyNamePublic: false }), job(J3, 'HN_2', 'Hà Nội', 'PM')];
  const list = jobsForPrompt(jobs, normalizeFlow({ facts: { careerTrack: 'BrSE', location: 'Hà Nội' }, offeredJobIds: [J3] }));
  assert.deepEqual(list.map((item) => item.code), ['HN_1', 'HCM_1']);
  assert.match(list[0].congTy, /không được nói tên/);
});
test("Hola's answer becomes the draft and the next state; unknown job codes are ignored", () => {
  const jobs = [{ id: J1, code: 'HN_1' }];
  const applied = applyHolaResult({ step: 5, facts: { careerTrack: null, location: 'Hà Nội', japaneseLevel: null, japanYears: null, experience: null, expectedSalary: null, motivation: null, availability: null },
    offeredJobCode: 'HN_1', rejectedJobCode: 'NOPE', rejectReason: null, outcome: null, parts: ['Em có vị trí BrSE tại Cty A.', '---', 'Anh thấy ổn không ạ.'] },
    normalizeFlow({ facts: { careerTrack: 'BrSE', location: 'HN', japaneseLevel: 'N2', experience: '3 năm BrSE', motivation: 'lương' } }), jobs);
  assert.equal(applied.draft, 'Em có vị trí BrSE tại Cty A.\n---\nAnh thấy ổn không ạ.');
  assert.deepEqual(applied.next.offeredJobIds, [J1]);
  assert.deepEqual(applied.next.rejectedJobs, []);
  assert.deepEqual(applied.next.facts, { careerTrack: 'BrSE', location: 'Hà Nội', japaneseLevel: 'N2', experience: '3 năm BrSE', motivation: 'lương' });
  assert.equal(applied.next.step, 5);
  const cv = applyHolaResult({ step: 7, facts: {}, offeredJobCode: null, rejectedJobCode: null, rejectReason: null, outcome: 'CV_RECEIVED', parts: ['Em nhận được CV rồi ạ.'] }, EMPTY_FLOW, jobs);
  assert.equal(cv.next.step, 8);
  assert.equal(cv.next.outcome, 'CV_RECEIVED');
  assert.equal(applyHolaResult({ step: 2, parts: [] }, EMPTY_FLOW, jobs), null);
});
test('a composer text splits into messages on lines of ---', () => {
  assert.deepEqual(splitParts('Chào anh\n---\nAnh quan tâm hướng nào ạ'), ['Chào anh', 'Anh quan tâm hướng nào ạ']);
  assert.deepEqual(splitParts('Một tin\n\nvẫn một tin'), ['Một tin\n\nvẫn một tin']);
  assert.deepEqual(splitParts('a\n --- \nb\n----\nc'), ['a', 'b', 'c']);
});
test('the schema and instructions carry the approved rules', () => {
  assert.deepEqual(HOLA_RESULT_SCHEMA.required, ['step', 'facts', 'offeredJobCode', 'rejectedJobCode', 'rejectReason', 'outcome', 'parts']);
  const text = holaInstructions();
  assert.match(text, /Không emoji/);
  assert.match(text, /CHO_UNG_VIEN_TRA_LOI = true/);
  assert.match(text, /xưng chị thì gọi chị/);
  assert.match(text, /Tiếng Nhật hiện tại của anh khoảng N mấy rồi ạ, anh đã từng sống hoặc làm việc ở Nhật lâu chưa anh/);
});

test('Hole keeps the shared voice, data and output rules but is free to reorder and asks for the CV', () => {
  const hole = holeInstructions(), hola = holaInstructions();
  assert.match(hole, /^Bạn là Hole/);
  for (const part of ['NỐI TIẾP', 'GIỌNG', 'DỮ LIỆU', 'AN TOÀN', 'ĐẦU RA']) assert.ok(hole.includes(part), part);
  assert.match(hole, /NHẬN CV/);
  assert.ok(!hole.includes('Câu mẫu'), 'Hole does not read the script lines');
  assert.notEqual(hole, hola);
});

test('every outcome has tags; a CV means "Chờ REC care"; care task titles are bounded', () => {
  for (const outcome of REC_OUTCOMES) assert.ok(OUTCOME_TAGS[outcome].length > 0 && OUTCOME_TAGS[outcome].every((tag) => /^#[0-9A-F]{6}$/i.test(tag.color)));
  assert.deepEqual(OUTCOME_TAGS.CV_RECEIVED.map((tag) => tag.name), ['Đã có CV', 'Chờ REC care']);
  assert.equal(OUTCOME_TAGS.NEED_OTHER_JOB[0].name, 'Cần job khác');
  assert.equal(careTaskTitle(' Cao Thị Thu Thảo '), 'Care CV: Cao Thị Thu Thảo');
  assert.equal(careTaskTitle(null), 'Care CV: ứng viên');
  assert.equal(careTaskTitle('x'.repeat(500)).length, 240);
});

test('no specific job before the candidate is understood', () => {
  const early = normalizeFlow({ step: 2, facts: { careerTrack: 'PM', location: 'HCM' } });
  assert.equal(readyForOffer(early), false);
  assert.deepEqual(offerMissing(early.facts), ['tiếng Nhật', 'kinh nghiệm', 'ưu tiên khi chuyển hoặc lương mong muốn']);
  const jumped = applyHolaResult({ step: 5, facts: {}, offeredJobCode: 'HN_1', rejectedJobCode: null, rejectReason: null, outcome: null, parts: ['Em có job Sabitech.'] }, early, [{ id: J1, code: 'HN_1' }]);
  assert.deepEqual(jumped.next.offeredJobIds, []);
  assert.equal(jumped.next.step, 4);
  assert.equal(readyForOffer(normalizeFlow({ facts: { careerTrack: 'PM', location: 'HCM', japaneseLevel: 'N3', experience: '5 năm', expectedSalary: '50M' } })), true);
});

test('the overview groups jobs by track and area without company names', () => {
  const overview = jobOverview([job(J1, 'A', 'Hà Nội', 'BrSE'), job(J2, 'B', 'Hà Nội', 'BrSE'), job(J3, 'C', 'Hồ Chí Minh', 'PM')]);
  assert.equal(overview.length, 2);
  assert.equal(overview[0].soJob, 2);
  assert.ok(!JSON.stringify(overview).includes('Cty'));
});

test('the flow is saved only when the sent text is still the AI draft', () => {
  const draft = 'Dạ, hướng PM và BrSE đều có job phù hợp ở HCM ạ.\n---\nTiếng Nhật hiện tại của anh khoảng N mấy rồi ạ?';
  assert.equal(draftKept(draft, draft), true);
  assert.equal(draftKept(draft, 'Dạ hướng PM và BrSE bên em đều có job ở HCM. Tiếng Nhật của anh khoảng N mấy rồi ạ?'), true);
  assert.equal(draftKept(draft, 'Ok anh, em gửi anh link nhóm nhé'), false);
  assert.equal(draftKept('', 'abc'), false);
});
