"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/modules/access/server/access-control";
import { categoryInputSchema, codeFromLabel, contentOptionInputSchema, findOption, optionsOf } from "@/modules/content/core/content-settings";
import { loadContentSettings } from "@/modules/content/server/content-settings-data";

export type SettingsActionResult = { ok: true; message: string; code?: string; id?: string } | { ok: false; message: string; fieldErrors?: Record<string, string[] | undefined> };
const denied: SettingsActionResult = { ok: false, message: "Bạn không có quyền sửa Cài đặt Kho content." };

function refresh() { revalidatePath("/content/settings"); revalidatePath("/content/templates"); revalidatePath("/content"); }

/** Adds or edits a Bộ phận / Định dạng / Ngôn ngữ / Phong cách. Entries are hidden, never deleted. */
export async function saveContentOption(input: unknown): Promise<SettingsActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return denied;
  const parsed = contentOptionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Kiểm tra lại các ô được đánh dấu.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined> };
  const value = parsed.data;
  const list = optionsOf(await loadContentSettings(), value.kind);
  const code = value.code || codeFromLabel(value.label, value.abbr);
  if (!value.code && findOption(list, code)) return { ok: false, message: "Đã có mục cùng mã, hãy đổi mã viết tắt.", fieldErrors: { abbr: ["Mã này đã dùng"] } };
  if (value.abbr && list.some((option) => option.code !== code && option.abbr === value.abbr)) return { ok: false, message: "Mã viết tắt đã dùng cho mục khác.", fieldErrors: { abbr: ["Mã này đã dùng"] } };
  if (value.code && !findOption(list, code)) return { ok: false, message: "Mục này không còn tồn tại." };
  const fields = { label: value.label, abbr: value.kind === "STYLE" ? null : value.abbr, active: value.active,
    word_min: value.kind === "FORMAT" ? value.wordMin : null, word_max: value.kind === "FORMAT" ? value.wordMax : null,
    guide: value.kind === "DEPARTMENT" || value.kind === "FORMAT" ? value.guide : null };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("content_options").select("id").eq("workspace_id", account.workspaceId).eq("kind", value.kind).eq("code", code).maybeSingle();
  const { error } = existing
    ? await supabase.from("content_options").update(fields).eq("id", existing.id).eq("workspace_id", account.workspaceId)
    : await supabase.from("content_options").insert({ ...fields, workspace_id: account.workspaceId, kind: value.kind, code,
      sort: findOption(list, code)?.sort ?? Math.max(0, ...list.map((option) => option.sort)) + 1 });
  if (error) return { ok: false, message: error.code === "23505" ? "Mã viết tắt đã dùng cho mục khác." : "Không lưu được, thử lại sau." };
  refresh();
  return { ok: true, message: value.code ? `Đã lưu “${value.label}”.` : `Đã thêm “${value.label}”.`, code };
}

/** Moves an entry one place up or down in its list. */
export async function moveContentOption(kind: string, code: string, direction: -1 | 1): Promise<SettingsActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return denied;
  if (!["DEPARTMENT", "FORMAT", "LANGUAGE", "STYLE"].includes(kind)) return { ok: false, message: "Mục không hợp lệ." };
  const list = optionsOf(await loadContentSettings(), kind as "DEPARTMENT");
  const index = list.findIndex((option) => option.code === code);
  const other = list[index + direction];
  if (index < 0 || !other) return { ok: true, message: "" };
  const supabase = await createClient();
  // Write the whole order so built-ins without a row get one.
  const order = [...list]; order[index] = other; order[index + direction] = list[index];
  for (const [position, option] of order.entries()) {
    const { data: existing } = await supabase.from("content_options").select("id").eq("workspace_id", account.workspaceId).eq("kind", kind).eq("code", option.code).maybeSingle();
    const { error } = existing
      ? await supabase.from("content_options").update({ sort: position + 1 }).eq("id", existing.id).eq("workspace_id", account.workspaceId)
      : await supabase.from("content_options").insert({ workspace_id: account.workspaceId, kind, code: option.code, label: option.label, abbr: option.abbr, active: option.active,
        word_min: option.wordMin, word_max: option.wordMax, sort: position + 1 });
    if (error) return { ok: false, message: "Không đổi được thứ tự." };
  }
  refresh();
  return { ok: true, message: "Đã đổi thứ tự." };
}

/** Adds or edits a Phân loại of a Bộ phận. */
export async function saveContentCategory(input: unknown): Promise<SettingsActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return denied;
  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Kiểm tra lại các ô được đánh dấu.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined> };
  const value = parsed.data;
  if (!findOption((await loadContentSettings()).departments, value.department)) return { ok: false, message: "Bộ phận không hợp lệ." };
  const supabase = await createClient();
  const fields = { name: value.name, abbr: value.abbr, active: value.active, guide: value.guide };
  if (value.id) {
    const { data, error } = await supabase.from("content_categories").update(fields).eq("id", value.id).eq("workspace_id", account.workspaceId).select("id");
    if (error || !data?.length) return { ok: false, message: error?.code === "23505" ? "Tên hoặc mã viết tắt đã có trong bộ phận này." : "Không lưu được phân loại." };
    refresh();
    return { ok: true, message: `Đã lưu phân loại “${value.name}”.`, id: value.id };
  }
  const { count } = await supabase.from("content_categories").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("department", value.department);
  const { data, error } = await supabase.from("content_categories").insert({ ...fields, workspace_id: account.workspaceId, department: value.department, sort: (count ?? 0) + 1 }).select("id").single();
  if (error || !data) return { ok: false, message: error?.code === "23505" ? "Tên hoặc mã viết tắt đã có trong bộ phận này." : "Không thêm được phân loại." };
  refresh();
  return { ok: true, message: `Đã thêm phân loại “${value.name}”.`, id: String(data.id) };
}
