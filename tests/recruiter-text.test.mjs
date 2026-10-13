import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clarificationReply, hasCvEvidence, humanizeRecruiterReply, isBareRecruiterGreeting, mentionsJob, messageContext, normalizedEvidence, recruiterProfileQuestion,
} from '../src/modules/ai-recruiter/core/recruiter-text.ts';

test('messageContext: text wins and is capped at 6000 characters', () => {
  assert.equal(messageContext({ text_content: 'Xin chào', attachment_count: 0, metadata: {} }), 'Xin chào');
  assert.equal(messageContext({ text_content: 'x'.repeat(7000), attachment_count: 0, metadata: {} }).length, 6000);
});

test('messageContext: describes attachments when there is no text', () => {
  const metadata = { attachments: [{ contentType: 'image/png', filename: 'a.png' }, { contentType: 'application/pdf', filename: 'CV.pdf' }, { filename: 'note.docx' }] };
  assert.equal(messageContext({ text_content: '  ', attachment_count: 3, metadata }), '[ảnh, tài liệu PDF (CV.pdf), tệp đính kèm (note.docx)]');
  assert.equal(messageContext({ text_content: null, attachment_count: 2, metadata: null }), '[2 tệp đính kèm]');
});

test('hasCvEvidence needs an attachment named like a CV', () => {
  assert.equal(hasCvEvidence({ text_content: 'đây là CV của em', metadata: {} }), false);
  assert.equal(hasCvEvidence({ text_content: null, metadata: { attachments: [{ filename: 'Nguyen_CV_2026.pdf' }] } }), true);
});

test('normalizedEvidence ignores case and spacing', () => {
  assert.equal(normalizedEvidence('  Em   có  N2 '), 'em có n2');
});

test('mentionsJob only matches company names of 3+ characters', () => {
  assert.equal(mentionsJob('Bên FPT Software đang tuyển', { company_name: 'FPT Software' }), true);
  assert.equal(mentionsJob('Bên AB đang tuyển', { company_name: 'AB' }), false);
});

test('humanizeRecruiterReply removes robotic acknowledgements', () => {
  assert.equal(humanizeRecruiterReply('Dạ em đã ghi nhận rằng anh ở Hà Nội.'), 'Anh ở Hà Nội.');
  assert.equal(humanizeRecruiterReply('Em ghi nhận anh không muốn ứng tuyển lại ABC. Em gửi job khác nhé'), 'Mình bỏ qua ABC nhé. Em gửi job khác nhé');
  assert.equal(humanizeRecruiterReply('Ok ..  nhé!!'), 'Ok. nhé!');
});

test('greeting detection', () => {
  for (const text of ['hi', 'Hello em', 'chào anh!', 'em ơi']) assert.equal(isBareRecruiterGreeting(text), true, text);
  assert.equal(isBareRecruiterGreeting('hi em, anh muốn làm BrSE'), false);
});

test('fallback questions follow the intro order', () => {
  assert.match(recruiterProfileQuestion('hi', {}), /^Em chào anh/);
  assert.match(recruiterProfileQuestion('anh cần việc', {}), /^Dạ được anh/);
  assert.match(recruiterProfileQuestion('x', { candidate_type: 'BrSE' }), /khu vực nào/);
  assert.match(recruiterProfileQuestion('x', { candidate_type: 'BrSE', location: 'Hà Nội' }), /tiếng Nhật/);
  assert.match(recruiterProfileQuestion('x', { candidate_type: 'BrSE', location: 'Hà Nội', japanese_level: 'N2' }), /Nhật chưa/);
  assert.equal(recruiterProfileQuestion('x', { candidate_type: 'BrSE', location: 'Hà Nội', japanese_level: 'N2', japan_years: 0 }), null);
});

test('clarificationReply uses only known facts', () => {
  assert.equal(clarificationReply({}), 'anh chia sẻ giúp em vị trí muốn ưu tiên nhất để em lọc job sát hơn nhé.');
  assert.equal(clarificationReply({ japanese_level: 'N2', years_experience: 5, primary_skills: ['Java', 'AWS'] }),
    'Với N2, 5 năm kinh nghiệm, Java/AWS, anh chia sẻ giúp em vị trí muốn ưu tiên nhất để em lọc job sát hơn nhé.');
});
