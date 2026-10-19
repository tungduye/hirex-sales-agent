import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ContentBrief } from "@/modules/content/core/content-options";
import type { ContentBriefWithCategory } from "@/modules/content/core/content-prompt";
import { activeOptions, findOption, optionLabel } from "@/modules/content/core/content-settings";
import { contentModel } from "@/modules/content/server/generate-content";
import { loadContentSettings } from "@/modules/content/server/content-settings-data";
import { runContentBatch } from "@/modules/content/server/run-content-batch";

/**
 * Saves a validated brief as a batch (with the member's own session, so RLS checks
 * content.create) and starts generation after the response is sent. Used by the "Tạo content"
 * popup and by Trợ lý HireX.
 */
export async function startContentBatch(account: { workspaceId: string; userId: string }, brief: ContentBrief): Promise<{ ok: true; batchId: string } | { ok: false; message: string }> {
  const model = contentModel();
  if (!model || !process.env.OPENAI_API_KEY) return { ok: false, message: "Chưa cấu hình OpenAI (OPENAI_API_KEY / OPENAI_MODEL) trên máy chủ." };
  // Only entries switched on in "Cài đặt Kho content" can be used for new content.
  const settings = await loadContentSettings();
  const department = findOption(activeOptions(settings.departments), brief.department);
  const format = findOption(activeOptions(settings.formats), brief.contentFormat);
  if (!department) return { ok: false, message: "Bộ phận này đang tắt trong Cài đặt Kho content." };
  if (!format) return { ok: false, message: "Định dạng này đang tắt trong Cài đặt Kho content." };
  if (!findOption(activeOptions(settings.languages), brief.contentLanguage)) return { ok: false, message: "Ngôn ngữ này đang tắt trong Cài đặt Kho content." };
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
    category_id: brief.categoryId,
    jd_text: brief.jdText,
    blocked_terms: brief.blockedTerms,
    template_ids: brief.templateIds,
    quantity: brief.quantity,
    job_id: brief.jobId ?? null,
    model,
  }).select("id").single();
  if (error || !batch) return { ok: false, message: error?.code === "23503" ? "Phân loại không thuộc bộ phận đã chọn." : "Không tạo được yêu cầu. Vui lòng thử lại." };
  const batchId = (batch as { id: string }).id;
  // The category name tells the AI which kind of post to write ("Dạng share", "Giới thiệu"…).
  const withCategory = await enrichBrief(brief, account.workspaceId);
  after(() => runContentBatch({ batchId, workspaceId: account.workspaceId, userId: account.userId, brief: withCategory, model }));
  revalidatePath("/content");
  return { ok: true, batchId };
}

/** The brief plus what Cài đặt Kho content says about its choices (labels, notes, word range). */
export async function enrichBrief(brief: ContentBrief, workspaceId: string): Promise<ContentBriefWithCategory> {
  const settings = await loadContentSettings();
  const department = findOption(settings.departments, brief.department);
  const format = findOption(settings.formats, brief.contentFormat);
  const parts = brief.contentLanguage.split("_");
  let enriched: ContentBriefWithCategory = {
    ...brief,
    departmentLabel: department?.label ?? null, departmentGuide: department?.guide ?? null,
    formatLabel: format?.label ?? null, formatGuide: format?.guide ?? null,
    wordRange: format?.wordMin && format.wordMax ? [format.wordMin, format.wordMax] : null,
    languageNames: Object.fromEntries(parts.map((part) => [part, optionLabel(settings.languages, part)])),
    styleLabel: findOption(settings.styles, brief.style)?.label ?? null,
  };
  if (brief.categoryId) {
    const { data: category } = await (await createClient()).from("content_categories").select("name, guide").eq("workspace_id", workspaceId).eq("id", brief.categoryId).maybeSingle();
    const row = category as { name: string; guide: string | null } | null;
    enriched = { ...enriched, categoryName: row?.name ?? null, categoryGuide: row?.guide ?? null };
  }
  return enriched;
}
