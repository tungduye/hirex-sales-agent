import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateItemRequest, briefFactText } from '../src/modules/content/core/content-prompt.ts';
import { leakedNumbers, lengthRange, templateProfile } from '../src/modules/content/core/template-plan.ts';
import { produceUniqueContent, MAX_REFERENCE_SIMILARITY } from '../src/modules/content/core/produce-unique-content.ts';
import { contentShingles } from '../src/modules/content/core/content-similarity.ts';

const LEARN_001 = `[Hà Nội] BrSE SENIOR- Lương 70M - 90 gross

Công ty thuần Nhật , tuyển gấp BrSE làm việc tại Cầu Giấy -  Hà Nội, process cực nhanh chỉ 1 vòng, có thể thực hiện online
Phỏng vẫn xong có kết quả luôn

Yêu cầu: Tối thiểu 3 năm kinh nghiệm lập trình, tiếng Nhật N2-N1.
Nhiệm vụ: Quản lý tiến độ, kiểm soát chất lượng code, làm cầu nối kỹ thuật với đối tác.

Anh em Brse nào đang định hướng PM thử job bên em ngay nha`;
const TEASER = 'HN - LƯƠNG DIVISION MANAGER N1/N2 80-100M- ANH EM QUAN TÂM IB EM NHA';

const brief = {
  jobTitle: 'BrSE HCM', position: 'BrSE', location: 'TP HCM', languagesRequired: 'N2', techSkills: null, salary: '50 - 65M gross',
  highlights: 'Công ty 100% vốn Nhật', jdText: 'Có kinh nghiệm BrSE/SE dự án Nhật', blockedTerms: null, style: 'FRIENDLY', styleNote: null,
  sampleContent: null, contentLanguage: 'VI', contentFormat: 'POST', department: 'REC', templateIds: [], quantity: 3,
};
const template = { id: 't1', code: 'LEARN_BRSE_001', department: 'REC', language: 'VI', groupName: 'URGENT_RECRUITMENT', tone: 'Recruiter gần gũi', cta: 'IB / gửi CV', body: LEARN_001, weight: 5, active: true };

test('profile of a full post and of a teaser', () => {
  const post = templateProfile(LEARN_001);
  assert.equal(post.title, '[Hà Nội] BrSE SENIOR- Lương 70M - 90 gross');
  assert.equal(post.titleUppercase, false);
  assert.equal(post.paragraphs, 3);
  assert.equal(post.teaser, false);
  assert.equal(post.bulletLines, 0);
  const [min, max] = lengthRange(post, 1);
  assert.ok(min > 150 && max < 600, `${min}-${max}`);
  assert.deepEqual(lengthRange(post, 2).map((value) => value > 0), [true, true]);
  const teaser = templateProfile(TEASER);
  assert.equal(teaser.teaser, true);
  assert.equal(teaser.title, null);
  const bullets = templateProfile('TIÊU ĐỀ VIẾT HOA\n\nMở bài\n- ý 1\n- ý 2\n- ý 3\nIB em');
  assert.equal(bullets.titleUppercase, true);
  assert.equal(bullets.bulletLines, 3);
  assert.equal(bullets.bulletMarker, '-');
});

test('per-item request asks to mirror the sample and to replace every fact', () => {
  const request = buildTemplateItemRequest({ brief, template, round: 0, avoid: [] });
  assert.match(request.instructions, /VIẾT LẠI bài mẫu/);
  assert.match(request.instructions, /GIỮ THEO MẪU/);
  assert.match(request.instructions, /THAY TOÀN BỘ DỮ KIỆN/);
  assert.match(request.instructions, /3 đoạn/);
  assert.match(request.instructions, /"\[HCM\]"/);
  assert.match(request.instructions, /đúng 1 item/);
  const input = JSON.parse(request.input);
  assert.equal(input.sample, LEARN_001);
  assert.equal(input.job.salary, '50 - 65M gross');
  assert.ok(request.maxOutputTokens > 1000);
  const email = buildTemplateItemRequest({ brief: { ...brief, contentFormat: 'EMAIL' }, template, round: 1, avoid: ['cũ'] });
  assert.match(email.instructions, /Email hoàn chỉnh/);
  assert.match(email.instructions, /input\.avoid/);
});

test('numbers copied from the sample are caught, numbers from the brief are fine', () => {
  const facts = briefFactText(brief);
  assert.deepEqual(leakedNumbers('[HCM] BrSE - Lương 50 - 65M gross, tiếng Nhật N2', LEARN_001, facts), []);
  assert.deepEqual(leakedNumbers('[HCM] BrSE - Lương 70M - 90 gross', LEARN_001, facts).sort(), ['70', '90']);
  assert.deepEqual(leakedNumbers('Tối thiểu 3 năm kinh nghiệm', LEARN_001, facts), ['3']);
  assert.deepEqual(leakedNumbers('chỉ 1 vòng phỏng vấn', LEARN_001, facts), []);
  assert.deepEqual(leakedNumbers('Năm 2027 mở rộng', LEARN_001, facts), []);
});

test('a draft may follow its sample closely but not copy it', async () => {
  const close = LEARN_001.replace('70M - 90', '50 - 65M').replace('Cầu Giấy -  Hà Nội', 'Quận 1 - HCM').replace('3 năm', 'nhiều năm');
  const references = [{ id: 'template:LEARN', shingles: contentShingles(LEARN_001) }];
  const copied = await produceUniqueContent({ quantity: 1, library: [], references, maxRewriteRounds: 0, generate: async () => [{ title: 't', body: close }] });
  assert.equal(copied.accepted.length, 0, 'near-copy of the sample is refused');
  const rewritten = 'Công ty 100% vốn Nhật đang tuyển gấp BrSE tại Quận 1, process gọn, phỏng vấn xong báo kết quả nhanh.\n\nYêu cầu: kinh nghiệm BrSE/SE dự án Nhật, tiếng Nhật N2.\nNhiệm vụ: Quản lý tiến độ, kiểm soát chất lượng code, làm cầu nối kỹ thuật với đối tác.\n\nAnh em BrSE ở HCM quan tâm IB em nha';
  const kept = await produceUniqueContent({ quantity: 1, library: [], references, maxRewriteRounds: 0, generate: async () => [{ title: 't', body: rewritten, templateId: 't1' }] });
  assert.equal(kept.accepted.length, 1, 'a rewrite that keeps a few signature phrases is accepted');
  assert.equal(kept.accepted[0].templateId, 't1');
  assert.ok(MAX_REFERENCE_SIMILARITY > 0.5);
});
