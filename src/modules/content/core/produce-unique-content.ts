// Generates content until the requested quantity is reached without breaking the 50% rule.
// Each draft is compared with the whole library and with drafts already accepted in this batch.
// Drafts that are too similar are sent back as "avoid" examples and regenerated, at most
// `maxRewriteRounds` times; whatever is still missing after that is reported as rejected.
// The generator is injected, so this is unit-tested without OpenAI (tests/content-generation.test.mjs).
import { contentShingles, isTooSimilar, mostSimilar, type IndexedContent } from "./content-similarity.ts";
import type { GeneratedItem } from "./content-prompt.ts";

export interface AcceptedContent extends GeneratedItem {
  similarity: number;
  /** Most similar saved library item, or null when the closest text is from this batch / nothing. */
  similarItemId: string | null;
  shingles: Set<string>;
}

export interface ProduceUniqueContentInput {
  quantity: number;
  library: IndexedContent[];
  /** Drafts to keep away from from the first round on (e.g. recent items for the same job). */
  initialAvoid?: string[];
  generate: (request: { count: number; round: number; avoid: string[] }) => Promise<GeneratedItem[]>;
  maxRewriteRounds?: number;
}

export interface ProduceUniqueContentResult {
  accepted: AcceptedContent[];
  rejected: number;
  rounds: number;
}

const BATCH_ID_PREFIX = "batch:";

export async function produceUniqueContent({ quantity, library, initialAvoid = [], generate, maxRewriteRounds = 2 }: ProduceUniqueContentInput): Promise<ProduceUniqueContentResult> {
  const accepted: AcceptedContent[] = [];
  const avoid = [...initialAvoid];
  let rounds = 0;

  for (let round = 0; round <= maxRewriteRounds && accepted.length < quantity; round++) {
    const needed = quantity - accepted.length;
    rounds++;
    const drafts = (await generate({ count: needed, round, avoid: [...avoid] })).slice(0, needed);
    for (const draft of drafts) {
      const shingles = contentShingles(draft.body);
      if (shingles.size === 0) continue;
      const batchIndex = accepted.map((item, index) => ({ id: `${BATCH_ID_PREFIX}${index}`, shingles: item.shingles }));
      const match = mostSimilar(shingles, [...library, ...batchIndex]);
      if (isTooSimilar(match.similarity)) {
        avoid.push(draft.body);
        continue;
      }
      accepted.push({
        ...draft,
        similarity: match.similarity,
        similarItemId: match.id && !match.id.startsWith(BATCH_ID_PREFIX) ? match.id : null,
        shingles,
      });
    }
  }

  return { accepted, rejected: quantity - accepted.length, rounds };
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
