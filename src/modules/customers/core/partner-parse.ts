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
  data: Row; search_text: string;
}

export function mapPartner(row: Row): MappedPartner | null {
  const id = Number(pickId(row, ["partnerId", "partner_id", "id"]));
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const mapped = {
    partner_id: id,
    name: pick(row, ["name", "partnerName", "companyName", "company"]),
    partner_type: pick(row, ["typeName", "partnerTypeName", "type", "partnerType"]),
    status: pick(row, ["statusName", "status"]),
    address: pick(row, ["address", "addressDetail"]),
    email: pick(row, ["email", "emailInfo", "mail"]),
    phone: pick(row, ["phone", "phoneNumber", "mobile", "tel", "telephone", "sdt"]),
    website: pick(row, ["website", "web", "url"]),
    contact_name: pick(row, ["contactName", "contact", "fullName", "representative", "personName"]),
    position: pick(row, ["position", "positionName", "title"]),
    sale_human_id: pickId(row, ["saleId", "sale", "saleUserId"]),
    sale_name: pick(row, ["saleName", "saleFullName", "sale"]) ?? objectName(row, "saleId"),
    am_human_id: pickId(row, ["rateAmId", "amId", "am"]),
    am_name: pick(row, ["rateAmName", "amName", "rateAm", "am"]) ?? objectName(row, "rateAmId"),
    am2_human_id: pickId(row, ["rateAmId2", "amId2", "am2"]),
    am2_name: pick(row, ["rateAmName2", "amName2", "rateAm2", "am2"]) ?? objectName(row, "rateAmId2"),
    note: pick(row, ["noteEmail", "note", "notes", "description"]),
    email_sent_at: pick(row, ["dateSendEmail", "sendEmailDate", "emailSentAt"]),
  };
  const search_text = fold([mapped.partner_id, mapped.name, mapped.email, mapped.phone, mapped.website, mapped.address, mapped.contact_name, mapped.position, mapped.sale_name, mapped.am_name, mapped.am2_name, mapped.status, mapped.partner_type]
    .filter((value) => value != null && value !== "").join(" ")).slice(0, 4000);
  // Keep the raw record small enough: long text fields are cut.
  const data: Row = {};
  for (const [key, value] of Object.entries(row).slice(0, 120)) data[key] = typeof value === "string" ? value.slice(0, 4000) : value;
  return { ...mapped, data, search_text };
}
