import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ContentBrief } from "@/modules/content/core/content-options";
import { contentModel } from "@/modules/content/server/generate-content";
import { runContentBatch } from "@/modules/content/server/run-content-batch";

/**
 * Saves a validated brief as a batch (with the member's own session, so RLS checks
 * content.create) and starts generation after the response is sent. Used by the "Tạo content"
 * popup and by Trợ lý HireX.
 */
export async function startContentBatch(account: { workspaceId: string; userId: string }, brief: ContentBrief): Promise<{ ok: true; batchId: string } | { ok: false; message: string }> {
  const model = contentModel();
  if (!model || !process.env.OPENAI_API_KEY) return { ok: false, message: "Chưa cấu hình OpenAI (OPENAI_API_KEY / OPENAI_MODEL) trên máy chủ." };
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
    jd_text: brief.jdText,
    blocked_terms: brief.blockedTerms,
    template_ids: brief.templateIds,
    quantity: brief.quantity,
    model,
  }).select("id").single();
  if (error || !batch) return { ok: false, message: "Không tạo được yêu cầu. Vui lòng thử lại." };
  const batchId = (batch as { id: string }).id;
  after(() => runContentBatch({ batchId, workspaceId: account.workspaceId, userId: account.userId, brief, model }));
  revalidatePath("/content");
  return { ok: true, batchId };
}
