// CVs from Human: POST /cv?page=&size=&sort=cvId,historyId,desc with a filter body; blockId picks the block
// ("CV_GOC", …). The row shape is read defensively, like Khách hàng: every field is kept in `data`, the columns
// HireX shows are picked from the names Human is known or likely to use, and coded values get their bộ mã name.
// Pure; covered by tests/human-cv-parse.test.mjs.
import { fold, parsePartnerPage } from "../../customers/core/partner-parse.ts";

export const HUMAN_CV_URL = "http://52.220.196.215:8088/cv";
export const HUMAN_CV_PAGE_SIZE = 5000;
export { parsePartnerPage as parseCvPage };

/** The filter the CV page of Human sends, for one block, up to today (Vietnam). */
export function cvFilter(blockKey: string, today: string) {
  return { keySearch: "", recerId: [], startDate: "", endDate: today, partnerId: [], checkJob: "all", partnerIdFromJob: null, positionId: [], skillId: [],
    statusCv1: [], statusCv2: [], typeView: false, address: "", dateSendEmail: "", description: "", rateEmailId: "", rateZaloId: "", rateAmId: "", rateAmId2: "",
    foreignLanguages: "", managementRank: "", skillTech: "", salary: "", certificates: "", rankJobId: "", blockId: blockKey, blockTime: [] };
}

type Row = Record<string, unknown>;
/** Field lookup by letters only (Human mixes cvName / cv_name / cvname). */
function field(row: Row, names: string[]): unknown {
  const wanted = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/gu, ""));
  const keys = new Map(Object.keys(row).map((key) => [key.toLowerCase().replace(/[^a-z0-9]/gu, ""), key]));
  for (const name of wanted) { const key = keys.get(name); if (key !== undefined && row[key] != null && row[key] !== "") return row[key]; }
  return null;
}
function text(row: Row, names: string[], max = 500): string | null {
  const value = field(row, names);
  if (typeof value === "string") return value.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max) || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const inner = value as Row; const label = inner.name ?? inner.fullName ?? inner.masterName ?? inner.title;
    return typeof label === "string" && label.trim() ? label.trim().slice(0, max) : null;
  }
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item ? String((item as Row).name ?? (item as Row).id ?? "") : String(item)).filter(Boolean).join(", ").slice(0, max) || null;
  return null;
}
function idOf(row: Row, names: string[]): string | null {
  const value = field(row, names);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 100);
  if (value && typeof value === "object" && !Array.isArray(value)) { const id = (value as Row).id ?? (value as Row).userId; if (typeof id === "number" || (typeof id === "string" && id)) return String(id); }
  return null;
}
function nameOf(row: Row, names: string[]): string | null {
  const value = field(row, names);
  if (value && typeof value === "object" && !Array.isArray(value)) { const name = (value as Row).name ?? (value as Row).fullName ?? (value as Row).email; return typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : null; }
  return null;
}
function time(row: Row, names: string[]): string | null {
  const value = field(row, names);
  if (typeof value === "number" && value > 1e11) return new Date(value).toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? `${raw}T00:00:00+07:00` : raw.replace(" ", "T");
  const at = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/u.test(iso) ? iso : `${iso}+07:00`);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** Vietnamese phone as "84xxxxxxxxx" (for matching), or null. */
export function phoneKey(value: string) {
  const digits = value.replace(/\D/gu, "");
  if (/^0\d{9}$/u.test(digits)) return `84${digits.slice(1)}`;
  if (/^84\d{9}$/u.test(digits)) return digits;
  if (/^\d{9}$/u.test(digits) && /^[35789]/u.test(digits)) return `84${digits}`;
  return null;
}
export function phoneKeys(value: string | null | undefined) {
  return [...new Set((value ?? "").split(/[,;/|\n]+|\s{2,}/u).map(phoneKey).filter((item): item is string => Boolean(item)))].slice(0, 5);
}
export function emailKeys(value: string | null | undefined) {
  return [...new Set((value ?? "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gu) ?? [])].slice(0, 5);
}

export type CodeNames = Map<number, string>;
/** "7222" or "7222,95016" → "Brse/PM, [Data Rec] IT JP" with the bộ mã; unknown codes stay as they are. */
export function named(value: string | null, codes: CodeNames) {
  if (!value) return null;
  return value.split(/\s*[,;]\s*/u).filter(Boolean).map((part) => /^\d{1,12}$/u.test(part) && codes.has(Number(part)) ? codes.get(Number(part))! : part).join(", ") || null;
}

export interface MappedCv {
  cv_id: number; history_id: number | null; code: string | null; name: string | null; phone: string | null; email: string | null; position: string | null; skill: string | null;
  skill_tech: string | null; location: string | null; languages: string | null; status1: string | null; status2: string | null; recer_human_id: string | null; recer_name: string | null;
  partner_name: string | null; companies: string | null; salary: string | null; human_created_at: string | null; human_updated_at: string | null;
  phone_keys: string[]; email_keys: string[]; data: Row; search_text: string;
}

export function mapCv(row: Row, codes: CodeNames = new Map()): MappedCv | null {
  const cvId = Number(field(row, ["cvId", "cv_id", "id"]));
  if (!Number.isSafeInteger(cvId) || cvId <= 0) return null;
  const historyId = Number(field(row, ["historyId", "history_id"]));
  const phone = text(row, ["phone", "phoneNumber", "cvPhone", "mobile", "sdt", "tel"], 200);
  const email = text(row, ["email", "cvEmail", "mail"], 300);
  const recer = idOf(row, ["recerId", "recer", "recId", "recerUserId"]);
  const mapped = {
    cv_id: cvId, history_id: Number.isSafeInteger(historyId) && historyId > 0 ? historyId : null,
    code: text(row, ["userCode", "code", "cvCode"], 60),
    name: text(row, ["cvName", "fullName", "candidateName", "name"], 200),
    phone, email,
    position: named(text(row, ["cvPosition", "positionName", "position", "positionId"], 300), codes),
    skill: named(text(row, ["cvSkill", "skillName", "skill", "skillId"], 300), codes),
    skill_tech: named(text(row, ["skillTech"], 500), codes),
    location: named(text(row, ["cvAddress", "address", "location"], 300), codes),
    languages: named(text(row, ["foreignLanguages", "language", "languages"], 300), codes),
    status1: named(text(row, ["statusCv1", "statusCv", "status1"], 200), codes),
    status2: named(text(row, ["statusCv2", "status2"], 300), codes),
    recer_human_id: recer, recer_name: nameOf(row, ["recerId", "recer", "recId"]) ?? text(row, ["recerName", "recName", "recer_name", "userName", "createdByName"], 200),
    partner_name: text(row, ["partnerName", "partner_name", "companyName"], 300),
    companies: text(row, ["history", "historyPartner", "companies"], 2000),
    salary: text(row, ["salary", "expectedSalary"], 200),
    human_created_at: time(row, ["createdDate", "createDate", "created_date", "createdAt", "dateCreate"]),
    human_updated_at: time(row, ["updateDate", "updatedDate", "update_date", "updatedAt", "lastModifiedDate"]),
    phone_keys: phoneKeys(phone), email_keys: emailKeys(email),
  };
  // Keep the raw record small enough: long text fields are cut.
  const data: Row = {};
  for (const [key, value] of Object.entries(row).slice(0, 150)) data[key] = typeof value === "string" ? value.slice(0, 2000) : value;
  const values = Object.values(mapped).filter((value): value is string => typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T/u.test(value));
  const extra = Object.entries(row).flatMap(([key, value]) => /^(description|note|certificates|managementRank)$/iu.test(key) && typeof value === "string" ? [value.slice(0, 1000)] : []);
  const search_text = fold([cvId, ...values, ...extra, ...mapped.phone_keys].join(" ")).slice(0, 6000);
  return { ...mapped, data, search_text };
}
