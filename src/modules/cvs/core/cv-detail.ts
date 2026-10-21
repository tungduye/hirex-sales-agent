// Hồ sơ chi tiết of one CV (GET /cv/{cvId}): unwrapped, cut to a safe size, flattened for search and for Soda.
// Pure; covered by tests/human-cv-parse.test.mjs.
import { fold } from "../../customers/core/partner-parse.ts";

type Value = unknown;

/** The record inside Human's envelope ({code, data}, {data:{…}}, or the record itself); null when none. */
export function unwrapDetail(value: Value): Record<string, unknown> | null {
  let current = value;
  for (let depth = 0; depth < 3 && current && typeof current === "object" && !Array.isArray(current); depth += 1) {
    const record = current as Record<string, unknown>;
    if (typeof record.code === "number" && record.code !== 200 && !("cvId" in record)) throw Error(`HUMAN_CODE_${record.code}`);
    if (record.data && typeof record.data === "object" && !("cvId" in record || "nameCv" in record)) { current = record.data; continue; }
    return record;
  }
  return current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : null;
}

/** Long strings cut, deep nesting and huge lists trimmed, so a copy stays small. */
export function trimDetail(value: Value, depth = 0): Value {
  if (typeof value === "string") return value.length > 8000 ? `${value.slice(0, 8000)}…` : value;
  if (Array.isArray(value)) return depth > 4 ? `[${value.length} mục]` : value.slice(0, 80).map((item) => trimDetail(item, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 4) return "{…}";
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200).map(([key, item]) => [key, trimDetail(item, depth + 1)]));
  }
  return value;
}

const html = (text: string) => text.replace(/<\/(p|div|li|h[1-6]|tr)>|<br\s*\/?\s*>/giu, "\n").replace(/<[^>]*>/gu, " ").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/[ \t]+/gu, " ").split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/gu, "\n\n").trim();

/** [path, text] of every non-empty text / number, nested ones as "parent › key" (lists numbered); at most 400. */
export function detailPairs(value: Value, prefix = "", out: Array<[string, string]> = [], depth = 0): Array<[string, string]> {
  if (out.length >= 400 || depth > 5) return out;
  if (Array.isArray(value)) { value.forEach((item, index) => detailPairs(item, `${prefix}${prefix ? " " : ""}${index + 1}`, out, depth + 1)); return out; }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) detailPairs(item, prefix ? `${prefix} › ${key}` : key, out, depth + 1);
    return out;
  }
  if (value == null || value === "" || typeof value === "boolean") return out;
  const text = typeof value === "string" ? html(value) : String(value);
  if (text) out.push([prefix, text.slice(0, 1500)]);
  return out;
}
export const detailLines = (value: Value) => detailPairs(value).map(([path, text]) => `${path}: ${text}`);

export const detailSearchText = (detail: Value) => fold(detailPairs(detail).map(([, text]) => text).join(" ")).slice(0, 12000);

/** Changes when the CV changes on the list: then the hồ sơ is fetched again. */
export function cvFingerprint(row: Record<string, unknown>) {
  return ["historyId", "updatedDate", "statusCv", "statusCv2", "changeStatus2Date", "changeDescriptionDate", "nameCv", "phone", "email"].map((key) => row[key] ?? "").join("|");
}
