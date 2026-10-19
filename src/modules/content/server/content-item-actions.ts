"use server";

// Actions on one saved content: rewrite it with a one-line request, mark where it was posted,
// count copies, save it as a template.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { hasPermission, requirePermission } from "@/modules/access/server/access-control";
import { contentBriefSchema, POST_CHANNELS } from "@/modules/content/core/content-options";
import { briefFactText, briefTitleIsJapanese, briefTitlePrefix, languageParts } from "@/modules/content/core/content-prompt";
import { draftProblem, finalizeTitle } from "@/modules/content/core/content-quality";
import { contentShingles, isTooSimilar, mostSimilar, storedSimilarity } from "@/modules/content/core/content-similarity";
import { findBlockedTerm, parseBlockedTerms } from "@/modules/content/core/template-plan";
import { contentModel, rewriteContent } from "@/modules/content/server/generate-content";
import { loadLibrary } from "@/modules/content/server/run-content-batch";
import { enrichBrief } from "@/modules/content/server/start-content-batch";

export type ItemActionResult = { ok: true; message: string } | { ok: false; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refresh = () => { revalidatePath("/content"); revalidatePath("/content/templates"); };

/** Rewrites one content following a short request ("ngắn hơn", "thêm lương"). Same code, new text. */
export async function rewriteContentItem(input: { id: string; note: string }): Promise<ItemActionResult> {
  const parsed = z.object({ id: z.string().regex(UUID), note: z.string().trim().min(2, "Nhập yêu cầu viết lại").max(300, "Tối đa 300 ký tự") }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const account = await requirePermission("content.create").catch(() => null);
  if (!account) return { ok: false, message: "Bạn không có quyền tạo content." };
  const db = createPrivilegedClient();
  const { data: item } = await db.from("content_items").select("id, title, body, created_by, batch_id").eq("id", parsed.data.id).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!item) return { ok: false, message: "Content không còn tồn tại." };
  if (item.created_by !== account.userId && !await hasPermission("content.templates")) return { ok: false, message: "Chỉ người tạo hoặc người quản lý kho mới viết lại được bài này." };
  const { data: batch } = await db.from("content_batches").select("*").eq("id", item.batch_id).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!batch) return { ok: false, message: "Không tìm thấy brief của bài này." };
  const brief = contentBriefSchema.safeParse({
    jobTitle: batch.job_title, position: batch.position ?? "", location: batch.location ?? "", languagesRequired: batch.languages_required ?? "", techSkills: batch.tech_skills ?? "",
    salary: batch.salary ?? "", highlights: batch.highlights ?? "", jdText: batch.jd_text ?? "", blockedTerms: batch.blocked_terms ?? "", style: { choice: "OTHER", other: batch.style },
    styleNote: batch.style_note ?? "", sampleContent: "", contentLanguage: batch.content_language, contentFormat: batch.content_format, department: batch.department,
    categoryId: batch.category_id ?? "", templateIds: [], jobId: batch.job_id ?? "", quantity: 1,
  });
  if (!brief.success) return { ok: false, message: "Brief của bài này không còn hợp lệ." };
  const model = contentModel();
  if (!model || !process.env.OPENAI_API_KEY) return { ok: false, message: "Chưa cấu hình AI." };
  const enriched = await enrichBrief(brief.data, account.workspaceId);
  try {
    const draft = await rewriteContent({ brief: enriched, title: item.title, body: item.body, note: parsed.data.note, model });
    if (!draft) return { ok: false, message: "AI chưa viết lại được, thử lại nhé." };
    const title = finalizeTitle(draft.title, briefTitlePrefix(enriched), briefTitleIsJapanese(enriched));
    if (findBlockedTerm(`${title}\n${draft.body}`, parseBlockedTerms(enriched.blockedTerms))) return { ok: false, message: "Bản viết lại chứa từ khóa cấm, thử lại nhé." };
    const problem = draftProblem({ title, body: draft.body }, { wordRange: enriched.wordRange ?? null, languageCount: languageParts(enriched.contentLanguage).length, facts: briefFactText(enriched), isComment: enriched.contentFormat === "COMMENT" });
    if (problem === "INVENTED_MONEY") return { ok: false, message: "Bản viết lại có mức lương không có trong brief nên không lưu, thử lại nhé." };
    const library = (await loadLibrary(db, account.workspaceId)).filter((row) => row.id !== item.id).map((row) => ({ id: row.id, shingles: contentShingles(row.body) }));
    const match = mostSimilar(contentShingles(draft.body), library);
    if (isTooSimilar(match.similarity)) return { ok: false, message: "Bản viết lại trùng quá 50% với một content khác, thử yêu cầu khác nhé." };
    const { error } = await db.from("content_items").update({ title, body: draft.body, max_similarity: storedSimilarity(match.similarity), most_similar_item_id: match.id }).eq("id", item.id).eq("workspace_id", account.workspaceId);
    if (error) return { ok: false, message: "Không lưu được bản viết lại." };
    refresh();
    return { ok: true, message: "Đã viết lại bài." };
  } catch {
    return { ok: false, message: "AI đang bận, thử lại sau ít phút." };
  }
}


/** "Đã đăng ở…": refuses a second mark of the same content in the same place. */
export async function markContentPosted(input: { id: string; channel: string; place: string }): Promise<ItemActionResult> {
  const parsed = z.object({ id: z.string().regex(UUID), channel: z.enum(POST_CHANNELS.map((item) => item.value) as [string, ...string[]]), place: z.string().trim().min(1, "Nhập tên nhóm / trang").max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const account = await requirePermission("content.view").catch(() => null);
  if (!account) return { ok: false, message: "Bạn không có quyền." };
  const supabase = await createClient();
  const { data: same } = await supabase.from("content_item_posts").select("id, place").eq("workspace_id", account.workspaceId).eq("content_item_id", parsed.data.id);
  if ((same ?? []).some((row) => String(row.place).trim().toLocaleLowerCase("vi") === parsed.data.place.toLocaleLowerCase("vi"))) return { ok: false, message: `Bài này đã đăng ở “${parsed.data.place}” rồi.` };
  const { error } = await supabase.from("content_item_posts").insert({ workspace_id: account.workspaceId, content_item_id: parsed.data.id, channel: parsed.data.channel, place: parsed.data.place, posted_by: account.userId });
  if (error) return { ok: false, message: "Không lưu được." };
  refresh();
  return { ok: true, message: `Đã ghi nhận đăng ở “${parsed.data.place}”.` };
}

export async function unmarkContentPosted(postId: string): Promise<ItemActionResult> {
  if (!UUID.test(postId)) return { ok: false, message: "Không hợp lệ." };
  const account = await requirePermission("content.view").catch(() => null);
  if (!account) return { ok: false, message: "Bạn không có quyền." };
  const { data, error } = await (await createClient()).from("content_item_posts").delete().eq("id", postId).eq("workspace_id", account.workspaceId).select("id");
  if (error || !data?.length) return { ok: false, message: "Chỉ người đánh dấu hoặc người quản lý kho mới bỏ được." };
  refresh();
  return { ok: true, message: "Đã bỏ đánh dấu." };
}

/** Counts a copy (used to suggest often-used content as a template). */
export async function recordContentCopy(id: string): Promise<void> {
  if (!UUID.test(id)) return;
  const account = await requirePermission("content.view").catch(() => null);
  if (!account) return;
  const db = createPrivilegedClient();
  const { data } = await db.from("content_items").select("copy_count").eq("id", id).eq("workspace_id", account.workspaceId).maybeSingle();
  if (data) await db.from("content_items").update({ copy_count: Number(data.copy_count ?? 0) + 1 }).eq("id", id).eq("workspace_id", account.workspaceId);
}

/** Saves a good content as a template of Kho mẫu (same folder, higher weight). */
export async function saveContentAsTemplate(id: string): Promise<ItemActionResult> {
  if (!UUID.test(id)) return { ok: false, message: "Không hợp lệ." };
  const account = await requirePermission("content.templates").catch(() => null);
  if (!account) return { ok: false, message: "Cần quyền “Quản lý kho mẫu”." };
  const supabase = await createClient();
  const { data: item } = await supabase.from("content_items").select("code, title, body, department, content_format, category_id, content_language").eq("id", id).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!item) return { ok: false, message: "Content không còn tồn tại." };
  const { data, error } = await supabase.from("content_templates").insert({ workspace_id: account.workspaceId, department: item.department, content_format: item.content_format,
    category_id: item.category_id, language: item.content_language, group_name: "TỪ KHO CONTENT", weight: 6, active: true, note: `Lưu từ ${item.code}`,
    body: `${item.title}\n\n${item.body}`.slice(0, 8000), created_by: account.userId }).select("code").single();
  if (error || !data) return { ok: false, message: "Không lưu được thành mẫu." };
  refresh();
  return { ok: true, message: `Đã lưu thành mẫu ${(data as { code: string }).code}.` };
}
