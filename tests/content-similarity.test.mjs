import test from 'node:test';
import assert from 'node:assert/strict';
import { contentShingles, contentSimilarity, contentTokens, isTooSimilar, mostSimilar, storedSimilarity } from '../src/modules/content/core/content-similarity.ts';

const a = 'HireX đang tìm Java Developer làm việc tại Hà Nội, mức lương lên tới 2.500 USD. Ứng viên cần 3 năm kinh nghiệm Spring Boot và tiếng Nhật N3.';
const b = 'Bạn đam mê backend? Một công ty Nhật tại Hà Nội cần kỹ sư Java thành thạo Spring Boot, giao tiếp tiếng Nhật N3, thu nhập hấp dẫn tới 2.500 USD mỗi tháng.';

test('tokens: words for Vietnamese/English, characters for Japanese', () => {
  assert.deepEqual(contentTokens('Xin CHÀO, thế-giới!'), ['xin', 'chào', 'thế', 'giới']);
  assert.deepEqual(contentTokens('Java開発者を募集'), ['java', '開', '発', '者', 'を', '募', '集']);
  assert.deepEqual(contentTokens('  ...  '), []);
  // NFKC: full-width letters equal ASCII
  assert.deepEqual(contentTokens('ＪＡＶＡ'), ['java']);
});

test('identical and contained texts are 100% similar', () => {
  assert.equal(contentSimilarity(a, a), 1);
  assert.equal(contentSimilarity(a, `${a} Ứng tuyển ngay hôm nay để nhận phản hồi trong 24 giờ.`), 1);
  assert.equal(contentSimilarity(a.toUpperCase(), a.replaceAll(',', ' ;')), 1);
});

test('same job written differently stays under 50%', () => {
  const s = contentSimilarity(a, b);
  assert.ok(s < 0.2, `expected low similarity, got ${s}`);
  assert.equal(isTooSimilar(s), false);
});

test('light paraphrase of most sentences is caught', () => {
  const edited = a.replace('đang tìm', 'tuyển').replace('Hà Nội', 'Hà Nội (Cầu Giấy)');
  assert.ok(isTooSimilar(contentSimilarity(a, edited)));
});

test('Japanese duplicate detection', () => {
  const ja = 'ハノイでJavaエンジニアを募集しています。日本語N3以上、Spring Bootの経験3年以上。';
  assert.equal(contentSimilarity(ja, ja + '是非ご応募ください。'), 1);
  assert.ok(contentSimilarity(ja, 'ホーチミンでデザイナーを探しています。Figmaが得意な方歓迎。') < 0.3);
  const sameJobRewritten = '日本のお客様と働くチャンス！ハノイのオフィスでJava開発を担当していただきます。Spring Bootを3年以上使った経験があり、日本語N3レベルの方を歓迎します。';
  assert.equal(isTooSimilar(contentSimilarity(ja, sameJobRewritten)), false);
});

test('threshold is strictly greater than 50%', () => {
  assert.equal(isTooSimilar(0.5), false);
  assert.equal(isTooSimilar(0.5001), true);
  assert.equal(storedSimilarity(0.49999), 0.4999);
  assert.equal(storedSimilarity(0.5), 0.5);
});

test('mostSimilar picks the closest library entry', () => {
  const library = [{ id: 'x', shingles: contentShingles(b) }, { id: 'y', shingles: contentShingles(a) }];
  assert.deepEqual(mostSimilar(contentShingles(a), library), { similarity: 1, id: 'y' });
  assert.deepEqual(mostSimilar(contentShingles('hoàn toàn khác biệt nội dung'), []), { similarity: 0, id: null });
  assert.equal(contentShingles('').size, 0);
  assert.deepEqual([...contentShingles('hai từ')], ['hai từ']);
});
