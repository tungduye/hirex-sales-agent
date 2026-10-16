// Splitting one recipient file into N draft email campaigns (Trợ lý HireX, phase 3b). Pure; unit-tested.

export interface Range { from: number; to: number }

/** N consecutive parts of `total` rows, in file order, sizes differing by at most one. */
export function splitEvenly(total: number, parts: number): Range[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error("PARTS");
  if (total < parts) throw new Error("TOO_FEW_ROWS");
  const base = Math.floor(total / parts);
  const extra = total % parts;
  const ranges: Range[] = [];
  let from = 0;
  for (let index = 0; index < parts; index++) {
    const size = base + (index < extra ? 1 : 0);
    ranges.push({ from, to: from + size });
    from += size;
  }
  return ranges;
}

/**
 * Sending mailboxes divided between the campaigns so no mailbox serves two of them: round robin
 * over the given order. Needs at least one mailbox per campaign.
 */
export function divideSenders<T>(senders: readonly T[], parts: number): T[][] {
  if (senders.length < parts) throw new Error("TOO_FEW_SENDERS");
  const groups: T[][] = Array.from({ length: parts }, () => []);
  senders.forEach((sender, index) => groups[index % parts].push(sender));
  return groups;
}

/** "Base — Phần 1/3"; a single campaign keeps the base name. Max 200 characters like the form. */
export function campaignNames(base: string, parts: number) {
  const clean = base.replace(/\s+/g, " ").trim().slice(0, 180) || "Chiến dịch";
  return Array.from({ length: parts }, (_, index) => parts === 1 ? clean : `${clean} — Phần ${index + 1}/${parts}`);
}

/** File name without extension, as a default campaign name. */
export function baseNameOf(fileName: string) {
  return fileName.replace(/\.(csv|xlsx)$/i, "").replace(/[_]+/g, " ").trim();
}
