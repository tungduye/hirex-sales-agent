// Duplicate check for the content library: no saved content may overlap another by more than 50%.
//
// Text is normalized (Unicode NFKC, lower case, punctuation removed) and split into tokens:
// words for space-separated scripts (Vietnamese, English) and single characters for Japanese
// and Chinese, which are written without spaces. Each text becomes the set of its 3-token
// shingles, and the similarity of two texts is the overlap coefficient
//   |A ∩ B| / min(|A|, |B|)
// so a short text copied from a longer one counts as 100% duplicate, not as a small share of
// the longer text. Pure module: unit-tested in tests/content-similarity.test.mjs.

export const MAX_CONTENT_SIMILARITY = 0.5;
const SHINGLE_SIZE = 3;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function contentTokens(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!normalized) return [];
  const tokens: string[] = [];
  for (const word of normalized.split(" ")) {
    let run = "";
    for (const char of word) {
      if (CJK.test(char)) {
        if (run) { tokens.push(run); run = ""; }
        tokens.push(char);
      } else {
        run += char;
      }
    }
    if (run) tokens.push(run);
  }
  return tokens;
}

export function contentShingles(text: string): Set<string> {
  const tokens = contentTokens(text);
  const shingles = new Set<string>();
  if (tokens.length === 0) return shingles;
  if (tokens.length < SHINGLE_SIZE) { shingles.add(tokens.join(" ")); return shingles; }
  for (let index = 0; index + SHINGLE_SIZE <= tokens.length; index++) {
    shingles.add(tokens.slice(index, index + SHINGLE_SIZE).join(" "));
  }
  return shingles;
}

/** 0 (nothing in common) … 1 (one text is contained in the other). */
export function shingleSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const shingle of small) if (large.has(shingle)) shared++;
  return shared / small.size;
}

export function contentSimilarity(a: string, b: string): number {
  return shingleSimilarity(contentShingles(a), contentShingles(b));
}

export interface IndexedContent {
  id: string;
  shingles: Set<string>;
}

export interface SimilarityMatch {
  similarity: number;
  /** Id of the most similar existing content, or null when nothing overlaps. */
  id: string | null;
}

/** Highest similarity between `shingles` and any entry of `library`. */
export function mostSimilar(shingles: Set<string>, library: Iterable<IndexedContent>): SimilarityMatch {
  let best: SimilarityMatch = { similarity: 0, id: null };
  for (const entry of library) {
    const similarity = shingleSimilarity(shingles, entry.shingles);
    if (similarity > best.similarity) {
      best = { similarity, id: entry.id };
      if (similarity >= 1) break;
    }
  }
  return best;
}

export function isTooSimilar(similarity: number) {
  return similarity > MAX_CONTENT_SIMILARITY;
}

/** Similarity rounded down to 4 decimals (the database column is numeric(5,4) and capped at 0.5). */
export function storedSimilarity(similarity: number) {
  return Math.floor(similarity * 10_000) / 10_000;
}
