"use server";

// Quick edits made right on the folder tree of Kho mẫu / Content đã tạo: rename, add, hide, reorder
// folders, move a template or a content into another folder, edit a content's text.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { hasPermission, requirePermission } from "@/modules/access/server/access-control";
import { codeFromLabel, findOption, optionsOf, suggestAbbr, uniqueAbbr, type OptionKind } from "@/modules/content/core/content-settings";
import { loadContentSettings } from "@/modules/content/server/content-settings-data";

export type QuickResult = { ok: true; message: string; id?: string } | { ok: false; message: string };
const denied: QuickResult = { ok: false, message: "Bạn không có quyền sửa thư mục Kho content." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["DEPARTMENT", "FORMAT", "LANGUAGE", "STYLE"] as const;
const label = z.string().trim().min(1, "Nhập tên").max(60, "Tối đa 60 ký tự");
function refresh() { revalidatePath("/content"); revalidatePath("/content/templates"); revalidatePath("/content/settings"); }
const manager = () => requirePermission("content.templates").catch(() => null);

/** Writes one field of a Bộ phận / Định dạng… (a built-in without a row gets one). */
async function writeOption(workspaceId: string, kind: OptionKind, code: string, fields: Record<string, unknown>) {
  const settings = await loadContentSettings();
  const option = findOption(optionsOf(settings, kind), code);
  if (!option) return "Mục này không còn tồn tại.";
  const supabase = await createClient();
  const { data: existing } = await supabase.from("content_options").select("id").eq("workspace_id", workspaceId).eq("kind", kind).eq("code", code).maybeSingle();
  const { error } = existing
    ? await supabase.from("content_options").update(fields).eq("id", existing.id).eq("workspace_id", workspaceId)
    : await supabase.from("content_options").insert({ workspace_id: workspaceId, kind, code, label: option.label, abbr: option.abbr, sort: option.sort, active: option.active,
      word_min: option.wordMin, word_max: option.wordMax, guide: option.guide, ...fields });
  return error ? "Không lưu được, thử lại sau." : null;
}

export async function renameFolder(input: { type: "option"; kind: string; code: string; name: string } | { type: "category"; id: string; name: string }): Promise<QuickResult> {
  const account = await manager();
  if (!account) return denied;
  const name = label.safeParse(input.name);
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  if (input.type === "option") {
    if (!(KINDS as readonly string[]).includes(input.kind)) return { ok: false, message: "Mục không hợp lệ." };
    const failed = await writeOption(account.workspaceId, input.kind as OptionKind, input.code, { label: name.data });
    if (failed) return { ok: false, message: failed };
  } else {
    if (!UUID.test(input.id)) return { ok: false, message: "Phân loại không hợp lệ." };
    const { data, error } = await (await createClient()).from("content_categories").update({ name: name.data }).eq("id", input.id).eq("workspace_id", account.workspaceId).select("id");
    if (error || !data?.length) return { ok: false, message: error?.code === "23505" ? "Bộ phận này đã có phân loại cùng tên." : "Không đổi được tên." };
  }
  refresh();
  return { ok: true, message: `Đã đổi tên thành “${name.data}”.` };
}

export async function setFolderActive(input: { type: "option"; kind: string; code: string; active: boolean } | { type: "category"; id: string; active: boolean }): Promise<QuickResult> {
  const account = await manager();
  if (!account) return denied;
  if (input.type === "option") {
    if (!(KINDS as readonly string[]).includes(input.kind)) return { ok: false, message: "Mục không hợp lệ." };
    const failed = await writeOption(account.workspaceId, input.kind as OptionKind, input.code, { active: input.active });
    if (failed) return { ok: false, message: failed };
  } else {
    if (!UUID.test(input.id)) return { ok: false, message: "Phân loại không hợp lệ." };
    const { error } = await (await createClient()).from("content_categories").update({ active: input.active }).eq("id", input.id).eq("workspace_id", account.workspaceId);
    if (error) return { ok: false, message: "Không cập nhật được." };
  }
  refresh();
  return { ok: true, message: input.active ? "Đã hiện lại." : "Đã ẩn (bài cũ vẫn giữ nguyên)." };
}

/** New Bộ phận or Phân loại from just a name; the abbr is made from the name and kept unique. */
export async function addFolder(input: { type: "department"; name: string } | { type: "category"; department: string; name: string }): Promise<QuickResult> {
  const account = await manager();
  if (!account) return denied;
  const name = label.safeParse(input.name);
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  const settings = await loadContentSettings();
  const supabase = await createClient();
  if (input.type === "department") {
    const abbr = uniqueAbbr(suggestAbbr(name.data), settings.departments.map((item) => item.abbr));
    let code = codeFromLabel(name.data, null);
    if (findOption(settings.departments, code)) code = codeFromLabel(name.data, abbr);
    if (findOption(settings.departments, code)) return { ok: false, message: "Đã có bộ phận này." };
    const { error } = await supabase.from("content_options").insert({ workspace_id: account.workspaceId, kind: "DEPARTMENT", code, label: name.data, abbr,
      sort: Math.max(0, ...settings.departments.map((item) => item.sort)) + 1 });
    if (error) return { ok: false, message: "Không thêm được bộ phận." };
    refresh();
    return { ok: true, message: `Đã thêm bộ phận “${name.data}” (mã ${abbr}).`, id: code };
  }
  if (!findOption(settings.departments, input.department)) return { ok: false, message: "Bộ phận không hợp lệ." };
  const { data: existing } = await supabase.from("content_categories").select("abbr, sort").eq("workspace_id", account.workspaceId).eq("department", input.department);
  const rows = (existing ?? []) as Array<{ abbr: string | null; sort: number }>;
  const abbr = uniqueAbbr(suggestAbbr(name.data), rows.map((row) => row.abbr));
  const { data, error } = await supabase.from("content_categories").insert({ workspace_id: account.workspaceId, department: input.department, name: name.data, abbr,
    sort: Math.max(0, ...rows.map((row) => row.sort)) + 1 }).select("id").single();
  if (error || !data) return { ok: false, message: error?.code === "23505" ? "Bộ phận này đã có phân loại cùng tên." : "Không thêm được phân loại." };
  refresh();
  return { ok: true, message: `Đã thêm phân loại “${name.data}” (mã ${abbr}).`, id: String(data.id) };
}

/** Puts a folder right before another one of the same level (drag and drop), or one step up/down. */
export async function reorderFolder(input: { type: "option"; kind: string; code: string; beforeCode: string | null } | { type: "category"; id: string; beforeId: string | null }): Promise<QuickResult> {
  const account = await manager();
  if (!account) return denied;
  const supabase = await createClient();
  if (input.type === "option") {
    if (!(KINDS as readonly string[]).includes(input.kind)) return { ok: false, message: "Mục không hợp lệ." };
    const list = optionsOf(await loadContentSettings(), input.kind as OptionKind);
    const moving = list.find((item) => item.code === input.code);
    if (!moving) return { ok: false, message: "Mục không còn tồn tại." };
    const rest = list.filter((item) => item.code !== input.code);
    const at = input.beforeCode ? rest.findIndex((item) => item.code === input.beforeCode) : rest.length;
    rest.splice(at < 0 ? rest.length : at, 0, moving);
    for (const [index, option] of rest.entries()) {
      if (option.sort === index + 1) continue;
      const failed = await writeOption(account.workspaceId, input.kind as OptionKind, option.code, { sort: index + 1 });
      if (failed) return { ok: false, message: failed };
    }
  } else {
    if (!UUID.test(input.id)) return { ok: false, message: "Phân loại không hợp lệ." };
    const { data: me } = await supabase.from("content_categories").select("department").eq("id", input.id).eq("workspace_id", account.workspaceId).maybeSingle();
    if (!me) return { ok: false, message: "Phân loại không còn tồn tại." };
    const { data } = await supabase.from("content_categories").select("id, sort, name").eq("workspace_id", account.workspaceId).eq("department", me.department);
    const list = ((data ?? []) as Array<{ id: string; sort: number; name: string }>).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "vi"));
    const rest = list.filter((item) => item.id !== input.id);
    const at = input.beforeId ? rest.findIndex((item) => item.id === input.beforeId) : rest.length;
    rest.splice(at < 0 ? rest.length : at, 0, list.find((item) => item.id === input.id)!);
    for (const [index, category] of rest.entries()) {
      if (category.sort === index + 1) continue;
      const { error } = await supabase.from("content_categories").update({ sort: index + 1 }).eq("id", category.id).eq("workspace_id", account.workspaceId);
      if (error) return { ok: false, message: "Không đổi được thứ tự." };
    }
  }
  refresh();
  return { ok: true, message: "Đã đổi thứ tự." };
}

const target = z.object({
  department: z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/),
  categoryId: z.string().regex(UUID).nullable(),
  format: z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/).nullable(),
});

/** Moves a template or a content into a folder (drag onto the tree). The code stays as it was. */
export async function moveToFolder(input: { kind: "template" | "content"; id: string; to: unknown }): Promise<QuickResult> {
  const account = await manager();
  if (!account) return { ok: false, message: "Cần quyền “Quản lý kho mẫu” để chuyển thư mục." };
  const to = target.safeParse(input.to);
  if (!UUID.test(input.id) || !to.success) return { ok: false, message: "Thư mục không hợp lệ." };
  const settings = await loadContentSettings();
  if (!findOption(settings.departments, to.data.department) || (to.data.format && !findOption(settings.formats, to.data.format))) return { ok: false, message: "Thư mục không hợp lệ." };
  const fields: Record<string, unknown> = { department: to.data.department, category_id: to.data.categoryId };
  if (to.data.format) fields.content_format = to.data.format;
  const db = input.kind === "template" ? await createClient() : createPrivilegedClient();
  const { data, error } = await db.from(input.kind === "template" ? "content_templates" : "content_items").update(fields).eq("id", input.id).eq("workspace_id", account.workspaceId).select("code");
  if (error || !data?.length) return { ok: false, message: error?.code === "23503" ? "Phân loại không thuộc bộ phận này." : "Không chuyển được." };
  refresh();
  return { ok: true, message: `Đã chuyển ${(data[0] as { code: string }).code}.` };
}

/** Edits the title and text of a saved content (its creator, or a library manager). */
export async function editContentItem(input: { id: string; title: string; body: string }): Promise<QuickResult> {
  const parsed = z.object({ id: z.string().regex(UUID), title: z.string().trim().min(1, "Nhập tiêu đề").max(300), body: z.string().trim().min(1, "Nhập nội dung").max(20000) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const account = await requirePermission("content.view").catch(() => null);
  if (!account) return { ok: false, message: "Bạn không có quyền sửa content." };
  const db = createPrivilegedClient();
  const { data: row } = await db.from("content_items").select("created_by").eq("id", parsed.data.id).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!row) return { ok: false, message: "Content không còn tồn tại." };
  if (row.created_by !== account.userId && !await hasPermission("content.templates")) return { ok: false, message: "Chỉ người tạo hoặc người quản lý kho mới sửa được content này." };
  const { error } = await db.from("content_items").update({ title: parsed.data.title.toLocaleUpperCase("vi"), body: parsed.data.body }).eq("id", parsed.data.id).eq("workspace_id", account.workspaceId);
  if (error) return { ok: false, message: "Không lưu được." };
  refresh();
  return { ok: true, message: "Đã lưu content." };
}
