import sanitizeHtml from "sanitize-html";

export type HumanDocument = { id: number; name: string; group: string; status: string; groupId?: number; folderPath?: string[] };
export type Evidence = { id: number; name: string; text: string };
export const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
export function plainStatus(html: string) {
  return sanitizeHtml(html.replace(/<\/(p|div|li|h[1-6]|tr)>|<br\s*\/?\s*>/gi, "\n"), { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
const stop = new Set("anh em cho toi hay la va cua trong nhung cac nay kia gi ve duoc mot co khong the nao tai lieu noi dung tom tat giup voi theo can bao nhieu".split(" "));
type IndexedDocument = { document: HumanDocument; search: string; title: string; chunks: { text: string; normalized: string; offset: number }[] };
const indexes = new WeakMap<HumanDocument[], IndexedDocument[]>();
export function documentIndex(documents: HumanDocument[]) {
  const existing = indexes.get(documents);
  if (existing) return existing;
  const index = documents.map(document => {
    const body = plainStatus(document.status);
    const title = normalize(document.name + " " + document.group);
    const chunks = [];
    for (let offset = 0; offset < body.length; offset += 1600) {
      const text = body.slice(offset, offset + 2000);
      chunks.push({ text, normalized: normalize(text), offset });
    }
    return { document, title, search: title + " " + normalize(body), chunks };
  });
  indexes.set(documents, index);
  return index;
}
export function retrieveEvidence(documents: HumanDocument[], question: string, selectedId?: number, options: { documentIds?: Set<number>; limit?: number; maxPerDocument?: number } = {}): Evidence[] {
  const terms = [...new Set(normalize(question).match(/[a-z0-9]+/g) ?? [])].filter(term => term.length > 1 && !stop.has(term));
  const pool = documentIndex(documents).filter(item => (!selectedId || item.document.id === selectedId) && (!options.documentIds || options.documentIds.has(item.document.id)));
  const candidates: (Evidence & { score: number; offset: number })[] = [];
  for (const { document: doc, title, chunks } of pool) {
    for (const { text, normalized, offset } of chunks) {
      const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 3 : 0) + (normalized.includes(term) ? 2 : 0), 0);
      if (score > 0 || selectedId) candidates.push({ id: doc.id, name: doc.name, text, score, offset });
    }
  }
  const sorted = candidates.sort((a, b) => b.score - a.score || a.offset - b.offset);
  const counts = new Map<number, number>();
  const selected: typeof sorted = [];
  for (const candidate of sorted) {
    const count = counts.get(candidate.id) ?? 0;
    if (count >= (options.maxPerDocument ?? Number.MAX_SAFE_INTEGER)) continue;
    selected.push(candidate); counts.set(candidate.id, count + 1);
    if (selected.length >= (options.limit ?? 8)) break;
  }
  return selected.map(({ id, name, text }) => ({ id, name, text }));
}

export function validateCitations(citations: { id: number; quote: string }[], evidence: Evidence[]) {
  return citations.length > 0 && citations.every(citation => citation.quote.trim().length >= 12 && evidence.some(source => source.id === citation.id && source.text.includes(citation.quote)));
}
