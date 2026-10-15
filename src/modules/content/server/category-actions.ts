"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/modules/access/server/access-control";
import { CONTENT_DEPARTMENTS } from "@/modules/content/core/content-options";
import type { ContentActionResult } from "@/modules/content/core/content-state";

const UUID = /^[0-9a-f-]{36}$/i;
const departments = CONTENT_DEPARTMENTS.map((item) => item.value) as [string, ...string[]];
const nameSchema = z.string().trim().min(1, "Nhập tên phân loại").max(60, "Tối đa 60 ký tự");

function refresh() { revalidatePath("/content/templates"); revalidatePath("/content"); }
const denied: ContentActionResult = { ok: false, message: "Bạn không có quyền quản lý phân loại." };

/** Adds a "Phân loại" to a department (people with content.templates). */
export async function addCategory(department: string, name: string): Promise<ContentActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return denied;
  const parsedName = nameSchema.safeParse(name);
  if (!z.enum(departments).safeParse(department).success || !parsedName.success) return { ok: false, message: parsedName.success ? "Bộ phận không hợp lệ." : parsedName.error.issues[0].message };
  const supabase = await createClient();
  const { count } = await supabase.from("content_categories").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("department", department);
  const { error } = await supabase.from("content_categories").insert({ workspace_id: account.workspaceId, department, name: parsedName.data, sort: (count ?? 0) + 1 });
  if (error) return { ok: false, message: error.code === "23505" ? "Bộ phận này đã có phân loại cùng tên." : "Không thêm được phân loại." };
  refresh();
  return { ok: true, message: `Đã thêm phân loại “${parsedName.data}”.` };
}

export async function renameCategory(categoryId: string, name: string): Promise<ContentActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return denied;
  const parsedName = nameSchema.safeParse(name);
  if (!UUID.test(categoryId) || !parsedName.success) return { ok: false, message: parsedName.success ? "Phân loại không hợp lệ." : parsedName.error.issues[0].message };
  const { data, error } = await (await createClient()).from("content_categories").update({ name: parsedName.data }).eq("id", categoryId).eq("workspace_id", account.workspaceId).select("id");
  if (error || !data?.length) return { ok: false, message: error?.code === "23505" ? "Bộ phận này đã có phân loại cùng tên." : "Không đổi được tên." };
  refresh();
  return { ok: true, message: "Đã đổi tên phân loại." };
}

/** Hidden categories stay on existing content but are no longer offered for new content. */
export async function setCategoryActive(categoryId: string, active: boolean): Promise<ContentActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return denied;
  if (!UUID.test(categoryId)) return { ok: false, message: "Phân loại không hợp lệ." };
  const { data, error } = await (await createClient()).from("content_categories").update({ active }).eq("id", categoryId).eq("workspace_id", account.workspaceId).select("id");
  if (error || !data?.length) return { ok: false, message: "Không cập nhật được phân loại." };
  refresh();
  return { ok: true, message: active ? "Đã bật lại phân loại." : "Đã ẩn phân loại." };
}

/** Deleting clears the category from templates and content (they are kept). */
export async function deleteCategory(categoryId: string): Promise<ContentActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return denied;
  if (!UUID.test(categoryId)) return { ok: false, message: "Phân loại không hợp lệ." };
  const { data, error } = await (await createClient()).from("content_categories").delete().eq("id", categoryId).eq("workspace_id", account.workspaceId).select("id");
  if (error || !data?.length) return { ok: false, message: "Không xóa được phân loại." };
  refresh();
  return { ok: true, message: "Đã xóa phân loại." };
}
