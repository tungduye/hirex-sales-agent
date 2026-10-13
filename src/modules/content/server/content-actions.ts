"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/modules/access/server/access-control";
import { briefInputFromFormData, contentBriefSchema } from "@/modules/content/core/content-options";
import type { ContentActionResult, CreateContentState } from "@/modules/content/core/content-state";
import { contentModel } from "@/modules/content/server/generate-content";
import { runContentBatch } from "@/modules/content/server/run-content-batch";

/**
 * Saves the brief as a batch and starts generation after the response is sent: writing and
 * de-duplicating up to 10 pieces can take a few minutes, longer than a browser request should wait.
 * The library page polls the batch status (see list-content.ts / content-library-view.tsx).
 */
export async function createContentBatch(_previous: CreateContentState, formData: FormData): Promise<CreateContentState> {
  const account = await requirePermission("content.create").catch(() => null);
  if (!account) return { success: false, message: "Bạn không có quyền tạo content." };

  const parsed = contentBriefSchema.safeParse(briefInputFromFormData(formData));
  if (!parsed.success) {
    return { success: false, message: "Kiểm tra lại các trường được đánh dấu.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[] | undefined> };
  }
  const brief = parsed.data;
  const model = contentModel();
  if (!model || !process.env.OPENAI_API_KEY) return { success: false, message: "Chưa cấu hình OpenAI (OPENAI_API_KEY / OPENAI_MODEL) trên máy chủ." };

  // Inserted with the signed-in user's client, so RLS checks content.create once more.
  const supabase = await createClient();
  const { data: batch, error } = await supabase.from("content_batches").insert({
    workspace_id: account.workspaceId,
    created_by: account.userId,
    job_title: brief.jobTitle,
    position: brief.position,
    location: brief.location,
    languages_required: brief.languagesRequired,
    tech_skills: brief.techSkills,
    salary: brief.salary,
    highlights: brief.highlights,
    style: brief.style,
    style_note: brief.styleNote,
    sample_content: brief.sampleContent,
    content_language: brief.contentLanguage,
    content_format: brief.contentFormat,
    department: brief.department,
    quantity: brief.quantity,
    model,
  }).select("id").single();
  if (error || !batch) return { success: false, message: "Không tạo được yêu cầu. Vui lòng thử lại." };

  const batchId = (batch as { id: string }).id;
  after(() => runContentBatch({ batchId, workspaceId: account.workspaceId, userId: account.userId, brief, model }));
  revalidatePath("/content");
  return { success: true, message: `Đang tạo ${brief.quantity} content cho “${brief.jobTitle}”. Kết quả sẽ hiện trong kho sau khoảng 1–2 phút.` };
}

export async function deleteContentItem(itemId: string): Promise<ContentActionResult> {
  const account = await requirePermission("content.delete").catch(() => null);
  if (!account) return { ok: false, message: "Bạn không có quyền xóa content." };
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return { ok: false, message: "Content không hợp lệ." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("content_items").delete().eq("id", itemId).eq("workspace_id", account.workspaceId).select("code");
  if (error || !data?.length) return { ok: false, message: "Không xóa được content. Vui lòng thử lại." };
  revalidatePath("/content");
  return { ok: true, message: `Đã xóa ${(data[0] as { code: string }).code}.` };
}
