// Soda, đợt 1 on the Khách hàng copy of Human: counts by ranking and block, companies newly in a block, and CV
// reports gathered over many companies (interviews by day and round, CVs waiting, …). Pure; covered by
// tests/customer-stats.test.mjs.
import { fold, parseCvReport, type CvItem } from "./partner-parse.ts";

export interface Block { block_id: number; name: string | null }

/** "Hot Do" → both Hot Do blocks, "IT" → every block with the word IT, "36309" → that block. Null = no filter; [] = no match. */
export function resolveBlocks(blocks: Block[], wanted: string | null | undefined): Block[] | null {
  const text = wanted?.trim();
  if (!text) return null;
  if (/^\d+$/u.test(text)) return blocks.filter((block) => block.block_id === Number(text));
  const words = fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).filter((word) => !["khoi", "nganh", "khach", "hang"].includes(word));
  if (!words.length) return null;
  return blocks.filter((block) => {
    const name = ` ${fold(block.name ?? "").replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    return words.every((word) => name.includes(` ${word} `));
  });
}

export const blockLabel = (block: Block) => block.name?.trim() || `Khối ${block.block_id}`;

/** First day a company was seen in any of these blocks (ISO), or null. */
export function enteredAt(blockSeen: unknown, blockIds: number[]): string | null {
  if (!blockSeen || typeof blockSeen !== "object" || Array.isArray(blockSeen)) return null;
  const days = blockIds.map((id) => (blockSeen as Record<string, unknown>)[String(id)]).filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return days.sort()[0] ?? null;
}

export type GroupBy = "HANG" | "XEP_HANG_DU_AN" | "XEP_HANG_AM" | "KHOI" | "DIA_DIEM" | "SALE" | "AM";
export interface PartnerStatRow {
  partner_id: number; name: string | null; block_ids: number[]; project_rank: string | null; job_rank: string | null; am_ranks: string[] | null;
  location: string | null; sale_human_id: string | null; am_human_id: string | null; sale_name?: string | null; am_name?: string | null; cv_total: number | null; cv_sent: number | null; cv_offer: number | null; cv_done: number | null;
}

/** Values a company counts under for a grouping (a company in two blocks counts in both). */
export function groupValues(row: PartnerStatRow, by: GroupBy, blockNames: Map<number, string>, people: Map<string, string>): string[] {
  const blank = "(trống)";
  switch (by) {
    case "XEP_HANG_DU_AN": return [row.project_rank || blank];
    case "XEP_HANG_AM": return row.am_ranks?.length ? row.am_ranks : [blank];
    case "KHOI": return row.block_ids.length ? row.block_ids.map((id) => blockNames.get(id) ?? `Khối ${id}`) : [blank];
    case "DIA_DIEM": return [row.location || blank];
    case "SALE": return [row.sale_human_id ? people.get(row.sale_human_id) ?? row.sale_name ?? `#${row.sale_human_id}` : blank];
    case "AM": return [row.am_human_id ? people.get(row.am_human_id) ?? row.am_name ?? `#${row.am_human_id}` : blank];
    default: return [row.job_rank || blank];
  }
}

/** Natural order: "Hạng 2" before "Hạng 10", blanks last. */
export function rankOrder(a: string, b: string) {
  if (a === "(trống)" || b === "(trống)") return a === b ? 0 : a === "(trống)" ? 1 : -1;
  return a.localeCompare(b, "vi", { numeric: true });
}

export function countBy(rows: PartnerStatRow[], by: GroupBy, blockNames: Map<number, string>, people: Map<string, string>) {
  const counts = new Map<string, { so_cong_ty: number; cv_tong: number; cv_da_gui: number; offer: number; xong: number }>();
  for (const row of rows) for (const value of groupValues(row, by, blockNames, people)) {
    const entry = counts.get(value) ?? { so_cong_ty: 0, cv_tong: 0, cv_da_gui: 0, offer: 0, xong: 0 };
    entry.so_cong_ty += 1; entry.cv_tong += row.cv_total ?? 0; entry.cv_da_gui += row.cv_sent ?? 0; entry.offer += row.cv_offer ?? 0; entry.xong += row.cv_done ?? 0;
    counts.set(value, entry);
  }
  return [...counts].sort(([a], [b]) => rankOrder(a, b)).map(([gia_tri, entry]) => ({ gia_tri, ...entry }));
}

// ---------------------------------------------------------------------------------------------
// CV reports over many companies
// ---------------------------------------------------------------------------------------------

export type CvKind = "PHONG_VAN" | "CHO_GUI" | "DA_GUI" | "OFFER" | "ONBOARD" | "FAIL";
const LISTS: Record<CvKind, string[]> = { PHONG_VAN: ["prList"], CHO_GUI: ["waitingList"], DA_GUI: ["sentList"], OFFER: ["offerList"], ONBOARD: ["oblist", "obList"], FAIL: ["falseList"] };
export const CV_KIND_LABEL: Record<CvKind, string> = { PHONG_VAN: "Phỏng vấn", CHO_GUI: "CV chờ gửi", DA_GUI: "CV đã gửi", OFFER: "Offer", ONBOARD: "Onboard", FAIL: "Fail" };

/** "PV2", "PV 2", "phỏng vấn vòng 2", "Vòng 2" → "PV2"; a status without a round → null. */
export function interviewRound(status: string | null | undefined): string | null {
  const text = fold(status ?? "");
  const match = /\b(?:pv|phong van|vong)\s*(?:vong\s*)?([1-9])\b/u.exec(text);
  return match ? `PV${match[1]}` : null;
}

/** Status text matches what was asked ("PV2" also finds "PV 2" and "vòng 2"). */
export function statusMatches(status: string | null, wanted: string | null | undefined) {
  if (!wanted?.trim()) return true;
  const round = interviewRound(wanted);
  if (round && /^\s*(?:pv|phong van|vong)/iu.test(fold(wanted))) return interviewRound(status) === round;
  return fold(status ?? "").includes(fold(wanted));
}

export interface GatheredCv { partnerId: number; company: string; kind: CvKind; item: CvItem }

/** Every CV of these kinds in the stored reports; `when` = interview day for interviews, else last update. */
export function gatherCvs(reports: Array<{ partner_id: number; name: string; data: unknown }>, kinds: CvKind[]): GatheredCv[] {
  const out: GatheredCv[] = [];
  for (const report of reports) {
    const lists = parseCvReport(report.data);
    for (const kind of kinds) for (const list of lists) if (LISTS[kind].includes(list.key)) for (const item of list.items) out.push({ partnerId: report.partner_id, company: report.name, kind, item });
  }
  return out;
}

export const cvDay = (cv: GatheredCv) => cv.kind === "PHONG_VAN" ? cv.item.interviewAt : cv.item.updatedAt;

/** A Human date ("2026-06-11", "2026-06-11 10:00:00", ISO with or without zone) as epoch ms, Vietnam time when no zone. */
export function humanTime(day: string | null | undefined): number {
  const text = (day ?? "").trim();
  if (!text) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return Date.parse(`${text}T00:00:00+07:00`);
  const iso = text.replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/u.test(iso) ? iso : `${iso}+07:00`);
}

/** Inside [from, to) when a range is given; CVs without a date only when no range is asked. */
export function inRange(day: string | null, from: Date | null, to: Date | null) {
  if (!from && !to) return true;
  const at = humanTime(day);
  if (!Number.isFinite(at)) return false;
  return (!from || at >= from.getTime()) && (!to || at < to.getTime());
}

/** Most common skills / positions (for "tóm tắt skill UV chờ gửi"). */
export function topValues(values: Array<string | null>, limit = 15) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const raw of values) for (const part of (raw ?? "").split(/[,/;|]+/u)) {
    const label = part.trim(); if (!label || label.length > 60) continue;
    const key = fold(label); const entry = counts.get(key) ?? { label, count: 0 }; entry.count += 1; counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "vi")).slice(0, limit).map((entry) => ({ gia_tri: entry.label, so_cv: entry.count }));
}
