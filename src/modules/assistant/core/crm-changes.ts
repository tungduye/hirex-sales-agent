// Field changes for "sửa liên hệ / sửa công ty" proposals. Pure; unit-tested.
// An argument of null means "keep", "" means "clear" (not allowed for required fields), other text
// is the new value. Values equal to the current one are not changes.

export interface FieldChange { column: string; label: string; before: string | null; after: string | null }
export interface FieldSpec { arg: string; column: string; label: string; required?: boolean }

const MAX = 500;

export function changedFields(row: Record<string, unknown>, args: Record<string, unknown>, fields: readonly FieldSpec[]): { list: FieldChange[] } | { error: string } {
  const list: FieldChange[] = [];
  for (const field of fields) {
    const raw = args[field.arg];
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "string") return { error: `${field.label} không hợp lệ.` };
    const value = raw.trim();
    if (value.length > MAX) return { error: `${field.label} quá dài.` };
    if (!value && field.required) return { error: `${field.label} không được để trống.` };
    const before = typeof row[field.column] === "string" && String(row[field.column]).trim() ? String(row[field.column]) : null;
    const after = value || null;
    if ((before ?? "") === (after ?? "")) continue;
    list.push({ column: field.column, label: field.label, before, after });
  }
  return { list };
}
