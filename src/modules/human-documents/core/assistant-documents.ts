// Document tools of Trợ lý HireX (admin only): search the imported library and read a document in
// parts. Pure — works on the snapshot's documents, unit-tested in tests/assistant-documents.test.mjs.
import { documentIndex, normalize, plainStatus, retrieveEvidence, type HumanDocument } from "./retrieval.ts";

export const DOCUMENT_PART_CHARS = 6000;
const SEARCH_LIMIT = 15;
const GROUP_LIMIT = 40;
const stop = new Set("anh em cho toi hay la va cua trong nhung cac nay kia gi ve duoc mot co khong the nao tai lieu noi dung tom tat giup voi theo can bao nhieu tim doc xem".split(" "));

export const documentLink = (id: number) => `/documents?id=${id}`;
const folderOf = (document: HumanDocument) => document.folderPath?.length ? document.folderPath.join(" / ") : null;

export function searchTerms(text: string) {
  return [...new Set(normalize(text).match(/[a-z0-9]+/g) ?? [])].filter((term) => term.length > 1 && !stop.has(term));
}

/** About `radius` characters of `text` around the first place one of the (normalized) terms occurs. */
export function snippetAround(text: string, terms: string[], radius = 120) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  // Normalize char by char so positions in the normalized text map back to the original.
  const starts: number[] = [];
  let normalized = "";
  for (let index = 0; index < flat.length; index++) {
    const part = normalize(flat[index]);
    for (let k = 0; k < part.length; k++) starts.push(index);
    normalized += part;
  }
  let hit = -1;
  for (const term of terms) {
    const at = normalized.indexOf(term);
    if (at >= 0 && (hit < 0 || at < hit)) hit = at;
  }
  const center = hit >= 0 ? starts[hit] : 0;
  const from = Math.max(0, center - radius);
  const to = Math.min(flat.length, center + radius);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to)}${to < flat.length ? "…" : ""}`;
}

/** Documents matching the keyword (name, group, folder and content), best match first. */
export function searchDocuments(documents: HumanDocument[], keyword: string | null, group: string | null) {
  const wantedGroup = group ? normalize(group).trim() : "";
  const inGroup = (document: HumanDocument) => !wantedGroup || normalize(document.group).includes(wantedGroup) || (document.folderPath ?? []).some((name) => normalize(name).includes(wantedGroup));
  const terms = keyword ? searchTerms(keyword) : [];
  const phrase = keyword ? normalize(keyword).trim() : "";
  const scored: { document: HumanDocument; score: number }[] = [];
  for (const item of documentIndex(documents)) {
    if (!inGroup(item.document)) continue;
    if (!terms.length) { scored.push({ document: item.document, score: 0 }); continue; }
    const folder = normalize((item.document.folderPath ?? []).join(" "));
    let score = phrase && item.search.includes(phrase) ? 5 : 0;
    let matched = 0;
    for (const term of terms) {
      const inTitle = item.title.includes(term) || folder.includes(term);
      const inBody = item.search.includes(term);
      if (inTitle || inBody) matched++;
      score += (inTitle ? 3 : 0) + (inBody ? 1 : 0);
    }
    // Long questions: most of the words must be there, not just one common word.
    if (matched > 0 && matched >= Math.min(terms.length, Math.ceil(terms.length * 0.5))) scored.push({ document: item.document, score: score + matched * 2 });
  }
  scored.sort((a, b) => b.score - a.score || a.document.name.localeCompare(b.document.name, "vi"));
  const groupCounts = new Map<string, number>();
  for (const document of documents) groupCounts.set(document.group, (groupCounts.get(document.group) ?? 0) + 1);
  return {
    tong_tai_lieu: documents.length,
    so_khop: scored.length,
    tai_lieu: scored.slice(0, SEARCH_LIMIT).map(({ document }) => ({
      id: document.id, ten: document.name, nhom: document.group, thu_muc: folderOf(document),
      doan_khop: terms.length ? snippetAround(plainStatus(document.status), terms) : null,
      link: documentLink(document.id),
    })),
    ...(scored.length > SEARCH_LIMIT ? { ghi_chu: `Chỉ hiện ${SEARCH_LIMIT} tài liệu khớp nhất; thêm từ khóa hoặc lọc theo nhóm để thu hẹp.` } : {}),
    // Without a keyword the model mostly wants the shape of the library.
    ...(!terms.length ? { nhom: [...groupCounts].sort((a, b) => b[1] - a[1]).slice(0, GROUP_LIMIT).map(([name, count]) => ({ ten: name, so_tai_lieu: count })), tong_nhom: groupCounts.size } : {}),
  };
}

/** One document: the passages matching `keyword`, or part `part` (1-based) of its full text. */
export function readDocument(documents: HumanDocument[], id: number, part: number | null, keyword: string | null) {
  const document = documents.find((item) => item.id === id);
  if (!document) return { loi: `Không có tài liệu #${id} trong bản dữ liệu đã nhập. Dùng tim_tai_lieu để lấy đúng id.` };
  const text = plainStatus(document.status);
  const parts = Math.max(1, Math.ceil(text.length / DOCUMENT_PART_CHARS));
  const base = { id: document.id, ten: document.name, nhom: document.group, thu_muc: folderOf(document), tong_ky_tu: text.length, so_phan: parts, link: documentLink(document.id) };
  if (!text) return { ...base, so_phan: 0, ghi_chu: "Tài liệu này chưa có nội dung status." };
  if (keyword && searchTerms(keyword).length) {
    const evidence = retrieveEvidence([document], keyword, undefined, { limit: 4 });
    if (evidence.length) return { ...base, cach_doc: "doan_lien_quan", noi_dung_tai_lieu: evidence.map((item) => item.text) };
  }
  const current = Math.min(Math.max(1, part ?? 1), parts);
  return {
    ...base, cach_doc: "theo_phan", phan: current,
    noi_dung_tai_lieu: text.slice((current - 1) * DOCUMENT_PART_CHARS, current * DOCUMENT_PART_CHARS),
    ...(current < parts ? { ghi_chu: `Còn ${parts - current} phần; gọi lại với phan=${current + 1} nếu cần đọc tiếp.` } : {}),
  };
}
