// Customers ("partner") from Human: POST /partner/getlist?page=&size=&sort=partner_id,desc with a filter body;
// blockId picks the block ("khối"). The response shape is read defensively: every field is kept in `data`,
// and the columns HireX shows are picked from the names Human is known or likely to use.

export const HUMAN_PARTNER_URL = "http://52.220.196.215:8088/partner/getlist";
export const HUMAN_PARTNER_PAGE_SIZE = 5000;

export function partnerFilter(blockId: number) {
  return { name: "", type: null, address: "", status: null, saleId: null, blockId: String(blockId), rankJobId: "", checkLinkined: "", checkLinkFacebook: "",
    rateEmailId: "", rateZaloId: "", checkEmail: null, dateSendEmail: "", contentId: "", noteEmail: "", email: "", other1: "", other2: "", position: "",
    emailInfo: "", website: "", rateAmId: "", rateAmId2: "", checkContactFilter: 0 };
}

type Row = Record<string, unknown>;

/** The rows of one page, whatever envelope Human wraps them in ({data:[…]}, {data:{content:[…]}}, {content:[…]}, […]). */
export function parsePartnerPage(value: unknown): { rows: Row[]; total: number | null } {
  const envelope = value as Record<string, unknown> | unknown[] | null;
  if (Array.isArray(envelope)) return { rows: envelope.filter(isRow), total: null };
  if (!envelope || typeof envelope !== "object") throw Error("INVALID_RESPONSE");
  if (typeof envelope.code === "number" && envelope.code !== 200) throw Error(`HUMAN_CODE_${envelope.code}`);
  const data = envelope.data ?? envelope.content ?? envelope.result;
  if (Array.isArray(data)) return { rows: data.filter(isRow), total: numberOf(envelope.totalElements ?? envelope.total) };
  if (data && typeof data === "object") {
    const inner = data as Record<string, unknown>;
    const list = inner.content ?? inner.data ?? inner.items ?? inner.list;
    if (Array.isArray(list)) return { rows: list.filter(isRow), total: numberOf(inner.totalElements ?? inner.total ?? inner.totalItems) };
  }
  throw Error("INVALID_RESPONSE");
}

function isRow(value: unknown): value is Row { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function numberOf(value: unknown) { const number = Number(value); return Number.isSafeInteger(number) ? number : null; }

/** First non-empty value among these field names (case-insensitive); objects give their name. */
function pick(row: Row, names: string[]): string | null {
  const keys = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = keys.get(name.toLowerCase());
    if (!key) continue;
    const value = row[key];
    if (value == null) continue;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 2000);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "object" && !Array.isArray(value)) {
      const inner = value as Row;
      const label = inner.name ?? inner.fullName ?? inner.masterName ?? inner.title ?? inner.email;
      if (typeof label === "string" && label.trim()) return label.trim().slice(0, 2000);
    }
  }
  return null;
}
function pickId(row: Row, names: string[]): string | null {
  const keys = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = keys.get(name.toLowerCase());
    const value = key ? row[key] : undefined;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 100);
    if (value && typeof value === "object" && !Array.isArray(value)) { const id = (value as Row).id ?? (value as Row).userId; if (typeof id === "number" || (typeof id === "string" && id)) return String(id); }
  }
  return null;
}

/** The name inside an id field that holds an object ({id, name}). */
function objectName(row: Row, key: string): string | null {
  const value = row[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = (value as Row).name ?? (value as Row).fullName;
  return typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : null;
}

export const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().replace(/\s+/gu, " ").trim();

export interface MappedPartner {
  partner_id: number; name: string | null; partner_type: string | null; status: string | null; address: string | null; email: string | null; phone: string | null;
  website: string | null; contact_name: string | null; position: string | null; sale_human_id: string | null; sale_name: string | null;
  am_human_id: string | null; am_name: string | null; am2_human_id: string | null; am2_name: string | null; note: string | null; email_sent_at: string | null;
  project_rank: string | null; job_rank: string | null; am_rank: string | null; am_rank2: string | null; am_ranks: string[]; location: string | null;
  cv_total: number | null; cv_sent: number | null; cv_processing: number | null; cv_offer: number | null; cv_done: number | null;
  human_created_at: string | null; human_created_by: string | null; last_note: string | null; last_note_at: string | null;
  data: Row; search_text: string;
}

/** Human code (masterId) → its name in the company's bộ mã; unknown codes stay as "Mã 123". */
export type CodeNames = Map<number, string>;
function codeName(value: unknown, codes: CodeNames): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const parts = text.split(/[,;]+/u).map((part) => part.trim()).filter((part) => part && part.toLowerCase() !== "null");
  if (!parts.length) return null;
  return [...new Set(parts.map((part) => /^\d+$/u.test(part) ? codes.get(Number(part)) ?? `Mã ${part}` : part))].join(", ").slice(0, 300);
}
const count = (value: unknown) => { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : null; };

/** Human's status log ("2026-09-16: MaiSA79 <p>…</p>"), as entries with plain text, oldest first. */
export function statusEntries(value: unknown): Array<{ date: string; author: string; text: string }> {
  if (typeof value !== "string" || !value.trim()) return [];
  const entries: Array<{ date: string; author: string; text: string }> = [];
  const pattern = /(?:^|\n)(\d{4}-\d{2}-\d{2}): ?(\S*)/gu;
  const marks = [...value.matchAll(pattern)];
  marks.forEach((mark, index) => {
    const start = (mark.index ?? 0) + mark[0].length;
    const end = index + 1 < marks.length ? marks[index + 1].index ?? value.length : value.length;
    const text = plain(value.slice(start, end)).replace(/^-\s*-?\s*/u, "").trim();
    const author = mark[2].startsWith("<") ? "" : mark[2];
    entries.push({ date: mark[1], author, text: (mark[2].startsWith("<") ? plain(mark[2]) + " " : "") + text });
  });
  return entries;
}
function plain(html: string) {
  return html.replace(/<br\s*\/?>(?!\n)/giu, "\n").replace(/<\/(p|div|li)>/giu, "\n").replace(/<[^>]*>/gu, "").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&#39;/gu, "'")
    .replace(/[ \t]+/gu, " ").replace(/\n\s*\n+/gu, "\n").trim();
}

export function mapPartner(row: Row, codes: CodeNames = new Map()): MappedPartner | null {
  const id = Number(pickId(row, ["partnerId", "partner_id", "id"]));
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const mapped = {
    partner_id: id,
    name: pick(row, ["partner_name", "partnerName", "name", "companyName", "company"]),
    partner_type: codeName(pick(row, ["typeName", "partnerTypeName", "type"]), codes),
    status: pick(row, ["statusName", "status"]),
    address: pick(row, ["address", "addressDetail"]),
    email: pick(row, ["email", "emailInfo", "mail"]),
    phone: pick(row, ["phone", "phoneNumber", "mobile", "tel", "telephone", "sdt"]),
    website: pick(row, ["website", "web", "url"]),
    contact_name: pick(row, ["contactName", "contact", "fullName", "representative", "personName"]),
    position: pick(row, ["position", "positionName", "title"]),
    sale_human_id: pickId(row, ["saleId", "sale", "saleUserId"]),
    sale_name: pick(row, ["saleName", "saleFullName", "sale"]) ?? objectName(row, "saleId"),
    // amId is the AM (a person); rateAmId / rateAmId2 are AM rankings (codes), below.
    am_human_id: pickId(row, ["amId", "am"]),
    am_name: pick(row, ["amName"]) ?? objectName(row, "amId"),
    am2_human_id: pickId(row, ["amId2", "am2"]),
    am2_name: pick(row, ["amName2"]) ?? objectName(row, "amId2"),
    note: pick(row, ["noteEmail", "note", "notes", "description"]),
    email_sent_at: pick(row, ["dateSendEmail", "sendEmailDate", "emailSentAt"]),
    project_rank: pick(row, ["typePartner"]),
    job_rank: codeName(pick(row, ["rankJobId"]), codes),
    am_rank: codeName(pick(row, ["rateAmId"]), codes),
    am_rank2: codeName(pick(row, ["rateAmId2"]), codes),
    am_ranks: [...new Set([pick(row, ["rateAmId"]), pick(row, ["rateAmId2"])].flatMap((value) => codeName(value, codes)?.split(", ") ?? []))].slice(0, 20),
    location: codeName(pick(row, ["address"]), codes),
    cv_total: count(row.allCv), cv_sent: count(row.allCvSent), cv_processing: count(row.cvProcessing), cv_offer: count(row.cvOffer), cv_done: count(row.cvDone),
    human_created_at: (() => { const value = pick(row, ["created_date", "createdDate"]); return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; })(),
    human_created_by: pick(row, ["created_by", "createdBy"]),
    ...(() => { const last = statusEntries(row.statusNew).at(-1); return { last_note: last ? `${last.author ? `${last.author}: ` : ""}${last.text}`.slice(0, 500) : null, last_note_at: last?.date ?? null }; })(),
  };
  const search_text = fold([mapped.partner_id, mapped.name, mapped.email, mapped.phone, mapped.website, mapped.address, mapped.contact_name, mapped.position, mapped.sale_name, mapped.am_name, mapped.am2_name, mapped.partner_type, mapped.project_rank, mapped.job_rank, mapped.am_rank, mapped.am_rank2, mapped.location, mapped.human_created_by]
    .filter((value) => value != null && value !== "").join(" ")).slice(0, 4000);
  // Keep the raw record small enough: long text fields are cut.
  const data: Row = {};
  for (const [key, value] of Object.entries(row).slice(0, 120)) data[key] = typeof value === "string" ? value.slice(0, 4000) : value;
  return { ...mapped, data, search_text };
}

/** Changes when the company's CV counts or status log change: then its CV report is fetched again. */
export function reportFingerprint(row: Record<string, unknown>) {
  const status = typeof row.statusNew === "string" ? row.statusNew : "";
  let hash = 0;
  for (let index = 0; index < status.length; index += 1) hash = (hash * 31 + status.charCodeAt(index)) | 0;
  return [row.allCv, row.allCvSent, row.cvProcessing, row.cvOffer, row.cvDone, status.length, hash].map((value) => value ?? "").join("|");
}
export const HUMAN_PARTNER_REPORT_URL = (partnerId: number) => `http://52.220.196.215:8088/applicationHistory/report/partner/${partnerId}`;

export interface CvItem {
  name: string; code: string | null; position: string | null; skill: string | null; address: string | null; status: string | null; statusCode: string | null;
  updatedAt: string | null; interviewAt: string | null; companies: string[]; cvId: number | null;
}
const LIST_NAMES: Record<string, string> = { waitingList: "CV chờ gửi", sentList: "CV đã gửi", falseList: "CV fail" };
const LIST_ORDER = ["waitingList", "sentList", "falseList"];

/** Human's CV report ({data:{waitingList, sentList, falseList}}) as named lists of CVs, newest first. */
export function parseCvReport(value: unknown): Array<{ key: string; label: string; items: CvItem[] }> {
  const envelope = value as Record<string, unknown> | null;
  const data = (envelope && typeof envelope === "object" && envelope.data && typeof envelope.data === "object" ? envelope.data : envelope) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return [];
  const text = (item: Record<string, unknown>, key: string) => { const raw = item[key]; return raw == null || raw === "" ? null : String(raw).trim().slice(0, 500) || null; };
  return Object.entries(data).filter(([, list]) => Array.isArray(list)).sort(([a], [b]) => (LIST_ORDER.indexOf(a) + 1 || 99) - (LIST_ORDER.indexOf(b) + 1 || 99)).map(([key, list]) => ({
    key, label: LIST_NAMES[key] ?? key.replace(/([a-z])([A-Z])/gu, "$1 $2"),
    items: (list as unknown[]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").map((item) => ({
      name: text(item, "cvName") ?? "Ứng viên", code: text(item, "userCode"), position: text(item, "cvPosition"), skill: text(item, "cvSkill"), address: text(item, "cvAddress"),
      status: text(item, "statusCv2"), statusCode: text(item, "statusCv"), updatedAt: text(item, "updateDate"), interviewAt: text(item, "interviewDate"),
      companies: typeof item.history === "string" ? item.history.split(",").map((part) => part.trim()).filter(Boolean).slice(0, 200) : [],
      cvId: Number.isSafeInteger(Number(item.cvId)) ? Number(item.cvId) : null,
    })).sort((a, b) => (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0)),
  }));
}

/** Counts for the list: chờ gửi, đã gửi, fail. */
export function cvReportCounts(value: unknown) {
  const lists = parseCvReport(value);
  const size = (key: string) => lists.find((list) => list.key === key)?.items.length ?? null;
  return lists.length ? { report_waiting: size("waitingList") ?? 0, report_sent: size("sentList") ?? 0, report_failed: size("falseList") ?? 0 } : null;
}
