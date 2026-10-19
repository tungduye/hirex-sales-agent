// Generates content until the requested quantity is reached without breaking the 50% rule.
// Each draft is compared with the whole library (plus any reference texts such as the sample
// templates, which must not be copied) and with drafts already accepted in this batch.
// Drafts that are too similar are sent back as "avoid" examples and regenerated, at most
// `maxRewriteRounds` times; whatever is still missing after that is reported as rejected.
// The generator is injected, so this is unit-tested without OpenAI (tests/content-generation.test.mjs).
import { contentShingles, isTooSimilar, mostSimilar, type IndexedContent } from "./content-similarity.ts";
import type { GeneratedItem } from "./content-prompt.ts";

/**
 * Following a sample closely is the point, so a draft may share more with its sample than with
 * other content; only a near-copy of a sample (above this) is refused.
 */
export const MAX_REFERENCE_SIMILARITY = 0.7;

export interface Draft extends GeneratedItem {
  /** Sample template the draft was written from, when any. */
  templateId?: string | null;
}

export interface AcceptedContent extends Draft {
  similarity: number;
  /** Most similar saved library item, or null when the closest text is a reference/this batch/nothing. */
  similarItemId: string | null;
  shingles: Set<string>;
}

export interface ProduceUniqueContentInput {
  quantity: number;
  /** Saved content items, by id. */
  library: IndexedContent[];
  /** Other texts the drafts must not copy (e.g. sample templates), compared at MAX_REFERENCE_SIMILARITY. */
  references?: IndexedContent[];
  /** Drafts to keep away from from the first round on (e.g. recent items for the same job). */
  initialAvoid?: string[];
  generate: (request: { count: number; round: number; avoid: string[] }) => Promise<Draft[]>;
  /** Normalizes a draft (e.g. title prefix) or returns null to drop it (blocked term, fact leak, wrong length). */
  prepare?: (draft: Draft) => Draft | null;
  maxRewriteRounds?: number;
  /** Extra drafts written in the first round; the best `quantity` (by `score`) are kept. */
  extra?: number;
  score?: (item: AcceptedContent) => number;
}

export interface ProduceUniqueContentResult {
  accepted: AcceptedContent[];
  rejected: number;
  rounds: number;
  /** Drafts dropped by `prepare`. */
  dropped: number;
}

const isSavedItemId = (id: string | null) => Boolean(id && !id.includes(":"));

export async function produceUniqueContent({ quantity, library, references = [], initialAvoid = [], generate, prepare, maxRewriteRounds = 2, extra = 0, score }: ProduceUniqueContentInput): Promise<ProduceUniqueContentResult> {
  const accepted: AcceptedContent[] = [];
  const avoid = [...initialAvoid];
  let rounds = 0;
  let dropped = 0;

  for (let round = 0; round <= maxRewriteRounds && accepted.length < quantity; round++) {
    const needed = quantity - accepted.length + (round === 0 ? extra : 0);
    rounds++;
    const drafts = (await generate({ count: needed, round, avoid: [...avoid] })).slice(0, needed);
    for (const raw of drafts) {
      const draft = prepare ? prepare(raw) : raw;
      if (!draft) { dropped++; continue; }
      const shingles = contentShingles(draft.body);
      if (shingles.size === 0) continue;
      const batchIndex = accepted.map((item, index) => ({ id: `batch:${index}`, shingles: item.shingles }));
      const match = mostSimilar(shingles, [...library, ...batchIndex]);
      const copiesSample = references.length > 0 && mostSimilar(shingles, references).similarity > MAX_REFERENCE_SIMILARITY;
      if (isTooSimilar(match.similarity) || copiesSample) {
        avoid.push(draft.body);
        continue;
      }
      accepted.push({ ...draft, similarity: match.similarity, similarItemId: isSavedItemId(match.id) ? match.id : null, shingles });
    }
  }

  // Written a few extra: keep the best ones.
  const kept = accepted.length > quantity && score ? [...accepted].sort((a, b) => score(b) - score(a)).slice(0, quantity) : accepted.slice(0, quantity);
  return { accepted: kept, rejected: quantity - kept.length, rounds, dropped };
}

/**
 * Final check just before saving, against items other people saved while this batch was being
 * generated. Returns the items that still pass, with their similarity updated.
 */
export function recheckAgainst(items: AcceptedContent[], newerLibrary: IndexedContent[]): AcceptedContent[] {
  if (newerLibrary.length === 0) return items;
  const kept: AcceptedContent[] = [];
  for (const item of items) {
    const match = mostSimilar(item.shingles, newerLibrary);
    if (isTooSimilar(match.similarity)) continue;
    kept.push(match.similarity > item.similarity ? { ...item, similarity: match.similarity, similarItemId: match.id } : item);
  }
  return kept;
}
