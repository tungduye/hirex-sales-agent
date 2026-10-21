import "server-only";

import { revalidatePath } from "next/cache";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { cleanFolder, documentTitle, HIREX_ROOT_FOLDER, latestRun, MAX_DOCUMENT_CHARS, textToHtml, type ChatMessage } from "@/modules/human-documents/core/hirex-documents";
import { hirexFolders, saveHirexDocument } from "@/modules/human-documents/server/hirex-documents";
import type { ActionContext, Built, Executed } from "@/modules/assistant/server/assistant-proposals";

// "Lưu tài liệu anh vừa nhắn vào mục Tài liệu": a card that keeps text in the library (Tài liệu HireX ›
// <thư mục>). On Zalo the text is read from the member's own messages just before the request, in full
// (the model only sees the first 1.000 characters of a message); on the web the model passes it.

/** The member's messages in this Zalo chat just before the request (newest first, the request itself left out). */
async function recentZaloText(context: ActionContext): Promise<{ text: string; parts: number; files: number } | { error: string }> {
  const db = createPrivilegedClient();
  const { data: links } = await db.from("assistant_zalo_links").select("zalo_user_id").eq("workspace_id", context.workspaceId).eq("profile_id", context.userId);
  const senders = (links ?? []).map((row) => String(row.zalo_user_id));
  if (!senders.length || !context.zaloConversationId) return { error: "Không xác định được Zalo của sếp trong chat này." };
  const { data } = await db.from("omnichannel_messages").select("id,text_content,attachment_count,created_at")
    .eq("workspace_id", context.workspaceId).eq("conversation_id", context.zaloConversationId).eq("direction", "INBOUND").in("sender_external_id", senders)
    .gte("created_at", new Date(Date.now() - 24 * 3_600_000).toISOString()).order("created_at", { ascending: false }).limit(61);
  const mine: ChatMessage[] = (data ?? []).map((row) => ({ id: String(row.id), text: typeof row.text_content === "string" ? row.text_content : null, at: String(row.created_at), attachments: Number(row.attachment_count ?? 0) }));
  const run = latestRun(mine.slice(1));
  const texts = run.map((message) => message.text?.trim() ?? "").filter(Boolean);
  const files = run.filter((message) => message.attachments > 0).length;
  if (!run.length) return { error: "Em không thấy tin nào sếp gửi trước đó trong 24 giờ qua ở chat này." };
  if (!texts.length) return { error: "Tin gần nhất sếp gửi là file. Zalo hiện chưa chuyển nội dung file sang HireX nên em chưa lưu được file; sếp dán nội dung chữ vào chat rồi nhờ em lưu nhé." };
  return { text: texts.join("\n"), parts: texts.length, files };
}

export async function proposeSaveDocument(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const source = args.nguon === "NOI_DUNG" || !context.zaloConversationId ? "NOI_DUNG" : "TIN_VUA_NHAN";
  let text: string, parts = 1, skippedFiles = 0;
  if (source === "NOI_DUNG") {
    text = typeof args.noi_dung === "string" ? args.noi_dung.trim() : "";
    if (!text) return { ok: false, error: context.zaloConversationId ? "Cần nội dung tài liệu (noi_dung)." : "Trên web: chép nguyên văn nội dung tài liệu người dùng đã gửi vào noi_dung." };
  } else {
    const found = await recentZaloText(context);
    if ("error" in found) return { ok: false, error: found.error };
    ({ text, parts } = found);
    skippedFiles = found.files;
  }
  if (text.length < 20) return { ok: false, error: "Nội dung quá ngắn để lưu thành tài liệu (dưới 20 ký tự)." };
  if (text.length > MAX_DOCUMENT_CHARS) return { ok: false, error: `Tài liệu quá dài (tối đa ${MAX_DOCUMENT_CHARS.toLocaleString("vi-VN")} ký tự).` };
  const folder = cleanFolder(typeof args.thu_muc === "string" ? args.thu_muc : null);
  const title = documentTitle(typeof args.tieu_de === "string" ? args.tieu_de : null, null, text);
  const known = await hirexFolders(context.workspaceId).catch(() => [] as string[]);
  const sameFolder = known.find((name) => name.toLocaleLowerCase("vi") === folder.toLocaleLowerCase("vi"));
  const finalFolder = sameFolder ?? folder;
  const opening = text.replace(/\s+/gu, " ").slice(0, 220);
  return {
    ok: true, kind: "SAVE_DOCUMENT",
    params: { title, folder: finalFolder, text, source: context.zaloConversationId ? "ZALO" : "WEB" },
    preview: {
      title: "Lưu vào Tài liệu",
      lines: [
        `Tên: ${title}`,
        `Thư mục: ${HIREX_ROOT_FOLDER} › ${finalFolder}${sameFolder || !known.length ? "" : " (thư mục mới)"}`,
        `Độ dài: ${text.length.toLocaleString("vi-VN")} ký tự${parts > 1 ? ` (gộp ${parts} tin liền nhau)` : ""}`,
        `Mở đầu: ${opening}${text.length > 220 ? "…" : ""}`,
      ],
      warning: skippedFiles ? `Bỏ qua ${skippedFiles} tin có file: Zalo chưa chuyển nội dung file sang HireX.` : null,
      link: "/documents",
    },
  };
}

export async function executeSaveDocument(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const text = typeof params.text === "string" ? params.text : "";
  const title = typeof params.title === "string" ? params.title : "";
  const folder = cleanFolder(typeof params.folder === "string" ? params.folder : null);
  if (!text.trim() || !title.trim()) return { ok: false, message: "Nội dung tài liệu không còn hợp lệ." };
  const id = await saveHirexDocument({ workspaceId: context.workspaceId, userId: context.userId, title, folder, html: textToHtml(text), chars: text.length, source: params.source === "ZALO" ? "ZALO" : "WEB" });
  revalidatePath("/documents");
  return { ok: true, message: `Đã lưu “${title}” vào Tài liệu › ${HIREX_ROOT_FOLDER} › ${folder}.`, link: `/documents?id=${id}` };
}
