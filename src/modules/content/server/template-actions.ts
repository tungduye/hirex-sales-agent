"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/modules/access/server/access-control";
import { contentTemplateSchema, templateInputFromFormData, type ContentTemplateInput } from "@/modules/content/core/content-options";
import type { ContentActionResult, TemplateFormState } from "@/modules/content/core/content-state";

const UUID = /^[0-9a-f-]{36}$/i;

function columns(input: ContentTemplateInput) {
  return {
    department: input.department,
    content_format: input.contentFormat,
    category_id: input.categoryId,
    language: input.language,
    group_name: input.groupName,
    tone: input.tone,
    cta: input.cta,
    tags: input.tags,
    note: input.note,
    weight: input.weight,
    active: input.active,
    body: input.body,
  };
}

function refresh() {
  revalidatePath("/content/templates");
  revalidatePath("/content");
}

/** Creates a template, or updates it when the form carries a templateId. */
export async function saveTemplate(_previous: TemplateFormState, formData: FormData): Promise<TemplateFormState> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return { success: false, message: "Bạn không có quyền quản lý kho mẫu." };
  const parsed = contentTemplateSchema.safeParse(templateInputFromFormData(formData));
  if (!parsed.success) {
    return { success: false, message: "Kiểm tra lại các trường được đánh dấu.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined> };
  }
  const templateId = formData.get("templateId");
  const supabase = await createClient();
  if (typeof templateId === "string" && templateId) {
    if (!UUID.test(templateId)) return { success: false, message: "Mẫu không hợp lệ." };
    const { data, error } = await supabase.from("content_templates").update(columns(parsed.data)).eq("id", templateId).eq("workspace_id", account.workspaceId).select("code");
    if (error || !data?.length) return { success: false, message: error?.code === "23503" ? "Phân loại không thuộc bộ phận đã chọn." : "Không lưu được mẫu. Vui lòng thử lại." };
    refresh();
    return { success: true, message: `Đã lưu mẫu ${(data[0] as { code: string }).code}.` };
  }
  const { data, error } = await supabase.from("content_templates")
    .insert({ ...columns(parsed.data), workspace_id: account.workspaceId, created_by: account.userId }).select("code").single();
  if (error || !data) return { success: false, message: error?.code === "23503" ? "Phân loại không thuộc bộ phận đã chọn." : "Không thêm được mẫu. Vui lòng thử lại." };
  refresh();
  return { success: true, message: `Đã thêm mẫu ${(data as { code: string }).code}.` };
}

export async function setTemplateActive(templateId: string, active: boolean): Promise<ContentActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return { ok: false, message: "Bạn không có quyền quản lý kho mẫu." };
  if (!UUID.test(templateId)) return { ok: false, message: "Mẫu không hợp lệ." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_templates").update({ active }).eq("id", templateId).eq("workspace_id", account.workspaceId).select("code");
  if (error || !data?.length) return { ok: false, message: "Không cập nhật được mẫu." };
  refresh();
  return { ok: true, message: `${active ? "Đã bật" : "Đã tắt"} mẫu ${(data[0] as { code: string }).code}.` };
}

export async function deleteTemplate(templateId: string): Promise<ContentActionResult> {
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return { ok: false, message: "Bạn không có quyền quản lý kho mẫu." };
  if (!UUID.test(templateId)) return { ok: false, message: "Mẫu không hợp lệ." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_templates").delete().eq("id", templateId).eq("workspace_id", account.workspaceId).select("code");
  if (error || !data?.length) return { ok: false, message: "Không xóa được mẫu." };
  refresh();
  return { ok: true, message: `Đã xóa mẫu ${(data[0] as { code: string }).code}.` };
}
