import "server-only";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleEmailAccountIds } from "@/modules/access/server/access-control";
import { baseNameOf, campaignNames, divideSenders, splitEvenly } from "@/modules/assistant/core/campaign-split";
import { validateRenderedCampaignMessage } from "@/modules/campaigns/domain/campaign-rules";
import { htmlToPlainText, sanitizeCampaignHtml } from "@/modules/campaigns/server/campaign-html";
import { emailHtmlOf } from "@/modules/content/core/campaign-content";
import { reserveContent, unavailableContent } from "@/modules/content/server/content-usage";
import type { ActionContext, Built, Executed } from "@/modules/assistant/server/assistant-proposals";

// Phase 3b: one recipient file (attached in the panel) → N DRAFT email campaigns, each with its own
// slice of the file, its own sending mailboxes and one unused Mail content from the library. One card
// covers all campaigns. Confirming only creates drafts: nothing is sent until someone launches a
// campaign on its page. Same storage and rules as the campaign form (createCampaign, setCampaignSenders,
// importCampaignAudience).

type Row = Record<string, unknown>;
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const DEFAULT_DAILY_CAP = 100;
const DEFAULT_PER_MINUTE_CAP = 10;
const safeLike = (value: string) => value.replace(/[%_,()\\]/g, " ").trim();

interface Sender { id: string; email: string }
interface PlannedCampaign { name: string; from: number; to: number; senders: Sender[]; contentId: string; contentCode: string; subject: string }

/** Upload of this member that has not expired. */
async function loadUpload(context: ActionContext, uploadId: string, withRecipients: boolean) {
  const { data } = await createPrivilegedClient().from("assistant_uploads").select(withRecipients ? "id,file_name,stats,recipients,expires_at" : "id,file_name,stats,expires_at")
    .eq("workspace_id", context.workspaceId).eq("user_id", context.userId).eq("id", uploadId).maybeSingle();
  const row = data as Row | null;
  if (!row || Date.parse(String(row.expires_at)) < Date.now()) return null;
  return row;
}

/** One member by name (exact first, then contains). */
async function findMember(context: ActionContext, name: string) {
  const { data } = await createPrivilegedClient().from("profiles").select("id,full_name,all_channel_accounts").eq("workspace_id", context.workspaceId).ilike("full_name", `%${safeLike(name)}%`).limit(6);
  const rows = (data ?? []) as Row[];
  const exact = rows.filter((row) => String(row.full_name).toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"));
  const pick = exact.length === 1 ? exact : rows;
  if (!pick.length) return { error: `Không tìm thấy thành viên tên "${name}".` };
  if (pick.length > 1) return { error: `Có nhiều thành viên khớp: ${pick.map((row) => row.full_name).join(", ")}. Hỏi lại người dùng chọn ai.` };
  return { id: String(pick[0].id), name: String(pick[0].full_name), all: pick[0].all_channel_accounts === true };
}

/**
 * The member's Gmail mailboxes: those granted to them (or all, for members with every account) and
 * those they connected themselves. Usable = connected, allowed to send, and usable by the requester.
 * `problems` explains the others so the assistant can say why a mailbox is left out.
 */
async function senderMailboxes(context: ActionContext, member: { id: string; all: boolean }): Promise<{ usable: Sender[]; problems: string[]; total: number }> {
  const db = createPrivilegedClient();
  let granted: string[] = [];
  if (!member.all) {
    const { data: access } = await db.from("profile_channel_account_access").select("channel_account_id").eq("workspace_id", context.workspaceId).eq("profile_id", member.id);
    const channelIds = (access ?? []).map((row) => String(row.channel_account_id));
    if (channelIds.length) {
      const { data: channels } = await db.from("channel_accounts").select("legacy_email_account_id").eq("workspace_id", context.workspaceId).in("id", channelIds).is("deleted_at", null).not("legacy_email_account_id", "is", null);
      granted = (channels ?? []).map((row) => String(row.legacy_email_account_id));
    }
  }
  let query = db.from("email_accounts").select("id,email_address,scopes,status,connected_by").eq("workspace_id", context.workspaceId).eq("provider", "GMAIL");
  if (!member.all) query = granted.length ? query.or(`connected_by.eq.${member.id},id.in.(${granted.join(",")})`) : query.eq("connected_by", member.id);
  const { data } = await query.order("email_address");
  const requester = await getAccessibleEmailAccountIds();
  const usable: Sender[] = [];
  const problems: string[] = [];
  for (const row of (data ?? []) as Row[]) {
    const email = String(row.email_address);
    if (row.status !== "CONNECTED") problems.push(`${email}: cần kết nối lại (${String(row.status)})`);
    else if (!(Array.isArray(row.scopes) && row.scopes.includes(GMAIL_SEND))) problems.push(`${email}: chưa cấp quyền gửi mail`);
    else if (requester !== null && !requester.includes(String(row.id))) problems.push(`${email}: người ra lệnh không có quyền dùng hộp này`);
    else usable.push({ id: String(row.id), email });
  }
  return { usable, problems, total: (data ?? []).length };
}

/** Unused Mail content: the codes given, or the newest unused ones matching the filters. */
async function pickContent(context: ActionContext, count: number, args: Record<string, unknown>): Promise<{ items: Row[] } | { error: string }> {
  const codes = Array.isArray(args.ma_content) ? args.ma_content.filter((code): code is string => typeof code === "string" && code.trim() !== "").map((code) => code.trim().toUpperCase()) : [];
  const db = createPrivilegedClient();
  let items: Row[];
  if (codes.length) {
    if (codes.length !== count) return { error: `Cần đúng ${count} mã content (mỗi chiến dịch 1 content), đang có ${codes.length}.` };
    const { data } = await db.from("content_items").select("id,code,title,body,content_format").eq("workspace_id", context.workspaceId).in("code", codes);
    items = codes.map((code) => ((data ?? []) as Row[]).find((row) => row.code === code)).filter((row): row is Row => Boolean(row));
    if (items.length !== count) return { error: "Có mã content không tồn tại trong Kho." };
    const used = await unavailableContent(db, context.workspaceId, items.map((row) => String(row.id)));
    if (used.length) return { error: `Content đã dùng cho chiến dịch khác: ${items.filter((row) => used.includes(String(row.id))).map((row) => row.code).join(", ")}.` };
  } else {
    const { data, error } = await (await createClient()).rpc("get_available_content_items", {
      p_format: "EMAIL", p_department: typeof args.bo_phan === "string" ? args.bo_phan : null, p_category_id: null,
      p_language: typeof args.ngon_ngu === "string" ? args.ngon_ngu : null, p_limit: count,
    });
    if (error) return { error: "Không đọc được Kho content (cần quyền xem Kho content)." };
    items = (data ?? []) as Row[];
    if (items.length < count) {
      return { error: `Kho chỉ còn ${items.length} content dạng Mail chưa dùng (cần ${count}, mỗi chiến dịch 1 content). Hỏi người dùng có muốn tạo thêm content Mail trước không (de_xuat_tao_content với dinh_dang EMAIL), rồi tạo chiến dịch sau.` };
    }
  }
  const notMail = items.filter((row) => row.content_format !== "EMAIL");
  if (notMail.length) return { error: `Content không phải dạng Mail: ${notMail.map((row) => row.code).join(", ")}.` };
  const invalid = items.filter((row) => validateRenderedCampaignMessage(String(row.title ?? ""), String(row.body ?? "")));
  if (invalid.length) return { error: `Content không dùng làm email được (tiêu đề hoặc nội dung không hợp lệ): ${invalid.map((row) => row.code).join(", ")}.` };
  return { items };
}

export async function proposeEmailCampaigns(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const upload = await loadUpload(context, String(args.upload_id), false);
  if (!upload) return { ok: false, error: "Không thấy file đính kèm (hoặc đã quá 24 giờ). Nhờ người dùng đính kèm lại file bằng nút 📎." };
  const stats = upload.stats as Row;
  const total = Number(stats.recipients ?? 0);
  const parts = Number(args.so_chien_dich);
  let ranges;
  try { ranges = splitEvenly(total, parts); } catch { return { ok: false, error: `File chỉ có ${total} người nhận, không chia được thành ${parts} chiến dịch.` }; }

  const mailboxOwner = typeof args.hop_mail_cua === "string" && args.hop_mail_cua.trim() ? await findMember(context, args.hop_mail_cua.trim()) : null;
  if (!mailboxOwner) return { ok: false, error: "Cần biết dùng hộp mail của thành viên nào (hop_mail_cua)." };
  if ("error" in mailboxOwner) return { ok: false, error: String(mailboxOwner.error) };
  const mailboxes = await senderMailboxes(context, mailboxOwner);
  const senders = mailboxes.usable;
  if (!senders.length) {
    return { ok: false, error: mailboxes.total
      ? `${mailboxOwner.name} có ${mailboxes.total} hộp Gmail (được cấp hoặc tự kết nối) nhưng chưa hộp nào dùng để gửi được: ${mailboxes.problems.slice(0, 8).join("; ")}.`
      : `${mailboxOwner.name} chưa được cấp và chưa tự kết nối hộp Gmail nào.` };
  }
  let groups: Sender[][];
  try { groups = divideSenders(senders, parts); } catch {
    return { ok: false, error: `${mailboxOwner.name} chỉ có ${senders.length} hộp Gmail dùng được (${senders.map((item) => item.email).join(", ")}), không chia riêng cho ${parts} chiến dịch. Hỏi người dùng muốn giảm số chiến dịch hay cho các chiến dịch dùng chung hộp mail.` };
  }

  let ownerName = mailboxOwner.name;
  if (typeof args.nguoi_phu_trach === "string" && args.nguoi_phu_trach.trim()) {
    const owner = await findMember(context, args.nguoi_phu_trach.trim());
    if ("error" in owner) return { ok: false, error: String(owner.error) };
    ownerName = owner.name;
  }

  const content = await pickContent(context, parts, args);
  if ("error" in content) return { ok: false, error: content.error };
  const names = campaignNames(typeof args.ten_chien_dich === "string" && args.ten_chien_dich.trim() ? args.ten_chien_dich : baseNameOf(String(upload.file_name)), parts);
  const campaigns: PlannedCampaign[] = ranges.map((range, index) => ({
    name: names[index], from: range.from, to: range.to, senders: groups[index],
    contentId: String(content.items[index].id), contentCode: String(content.items[index].code), subject: String(content.items[index].title).slice(0, 998),
  }));
  const removed = Number(stats.invalidEmailRows ?? 0) + Number(stats.duplicateRows ?? 0) + Number(stats.suppressedRows ?? 0);
  return {
    ok: true, kind: "CREATE_EMAIL_CAMPAIGNS",
    params: { uploadId: upload.id, fileName: upload.file_name, ownerName, campaigns },
    preview: {
      title: `Tạo ${parts} chiến dịch Email (bản nháp)`,
      lines: [
        `File: ${String(upload.file_name)} · ${total.toLocaleString("vi-VN")} người nhận${removed ? ` (đã loại ${removed.toLocaleString("vi-VN")} dòng sai/trùng/bị chặn)` : ""}`,
        `Phụ trách: ${ownerName} · Hộp gửi của ${mailboxOwner.name}, mỗi hộp ${DEFAULT_DAILY_CAP} mail/ngày, ${DEFAULT_PER_MINUTE_CAP} mail/phút`,
        ...campaigns.map((item, index) => `${index + 1}. ${item.name} — ${(item.to - item.from).toLocaleString("vi-VN")} người (dòng ${item.from + 1}–${item.to}) · gửi từ ${item.senders.map((sender) => sender.email).join(", ")} · nội dung ${item.contentCode}: “${item.subject.slice(0, 80)}”`),
      ],
      warning: `Chỉ tạo BẢN NHÁP, chưa gửi email nào. Kiểm tra từng chiến dịch rồi bấm khởi chạy trên trang chiến dịch.${mailboxes.problems.length ? ` Bỏ qua ${mailboxes.problems.length} hộp mail không dùng được: ${mailboxes.problems.slice(0, 5).join("; ")}.` : ""}`,
      link: "/campaigns",
    },
  };
}

export async function executeEmailCampaigns(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const upload = await loadUpload(context, String(params.uploadId), true);
  if (!upload) return { ok: false, message: "File đính kèm đã hết hạn (24 giờ). Hãy đính kèm lại và hỏi lại." };
  const recipients = upload.recipients as Array<Record<string, unknown>>;
  const campaigns = params.campaigns as PlannedCampaign[];
  const db = createPrivilegedClient();
  // Mailboxes: still connected and still usable by the member who confirms.
  const requester = await getAccessibleEmailAccountIds();
  const senderIds = campaigns.flatMap((item) => item.senders.map((sender) => sender.id));
  const { data: live } = await db.from("email_accounts").select("id,scopes").eq("workspace_id", context.workspaceId).eq("status", "CONNECTED").in("id", senderIds);
  const usable = new Set(((live ?? []) as Row[]).filter((row) => Array.isArray(row.scopes) && row.scopes.includes(GMAIL_SEND)).map((row) => String(row.id)).filter((id) => requester === null || requester.includes(id)));
  const lost = senderIds.filter((id) => !usable.has(id));
  if (lost.length) return { ok: false, message: "Có hộp mail gửi vừa mất kết nối hoặc không còn quyền dùng. Hãy hỏi lại để tạo thẻ mới." };
  const busy = await unavailableContent(db, context.workspaceId, campaigns.map((item) => item.contentId));
  if (busy.length) return { ok: false, message: "Có content vừa được dùng cho chiến dịch khác. Hãy hỏi lại để chọn content khác." };

  const created: string[] = [];
  for (const plan of campaigns) {
    const { data: content } = await db.from("content_items").select("title,body").eq("workspace_id", context.workspaceId).eq("id", plan.contentId).maybeSingle();
    const subject = String(content?.title ?? "").slice(0, 998);
    const bodyHtml = sanitizeCampaignHtml(emailHtmlOf(String(content?.body ?? "")));
    const body = htmlToPlainText(bodyHtml);
    if (!content || !bodyHtml || validateRenderedCampaignMessage(subject, body)) return partial(created, `Content ${plan.contentCode} không dùng làm email được.`);
    const { data: campaign, error } = await db.from("email_campaigns").insert({
      workspace_id: context.workspaceId, created_by: context.userId, name: plan.name, campaign_type: "Email Marketing", campaign_type_color: "#7c3aed",
      subject_template: subject, body_text_template: body, owner_name: String(params.ownerName ?? "").slice(0, 200) || null, status: "DRAFT", sequence_enabled: true,
    }).select("id").single();
    if (error || !campaign) return partial(created, `Không tạo được chiến dịch “${plan.name}”.`);
    const id = String(campaign.id);
    const { error: stepError } = await db.from("email_campaign_steps").insert({ workspace_id: context.workspaceId, campaign_id: id, step_order: 0, step_type: "INITIAL", delay_minutes: 0, subject_template: subject, body_text_template: body, body_html_template: bodyHtml, enabled: true });
    if (stepError || !await reserveContent(db, { workspaceId: context.workspaceId, kind: "EMAIL", campaignId: id, userId: context.userId, ids: [plan.contentId] })) {
      // Undo only this half-made draft (just created here, never launched).
      await db.from("email_campaigns").delete().eq("workspace_id", context.workspaceId).eq("id", id).eq("status", "DRAFT");
      return partial(created, `Không gắn được content ${plan.contentCode} cho “${plan.name}” (có thể vừa bị chiến dịch khác dùng).`);
    }
    await db.from("email_campaign_senders").insert(plan.senders.map((sender) => ({ workspace_id: context.workspaceId, campaign_id: id, email_account_id: sender.id, daily_cap: DEFAULT_DAILY_CAP, per_minute_cap: DEFAULT_PER_MINUTE_CAP, enabled: true })));
    // Recipients of this slice; addresses suppressed since the upload are skipped again.
    const slice = recipients.slice(plan.from, plan.to);
    let added = 0, suppressed = 0, failed = 0;
    for (let offset = 0; offset < slice.length; offset += 500) {
      const batch = slice.slice(offset, offset + 500);
      const { data: blocked } = await db.from("email_suppressions").select("normalized_email").eq("workspace_id", context.workspaceId).in("normalized_email", batch.map((row) => String(row.email)));
      const blockedSet = new Set((blocked ?? []).map((row) => String(row.normalized_email)));
      const eligible = batch.filter((row) => !blockedSet.has(String(row.email)));
      suppressed += batch.length - eligible.length;
      if (!eligible.length) continue;
      const { data: inserted, error: insertError } = await db.from("email_campaign_recipients")
        .upsert(eligible.map((row) => ({ email: row.email, normalized_email: row.normalized_email, display_name: row.display_name ?? null, company: row.company ?? null, position: row.position ?? null, personalization_json: row.personalization_json ?? {}, workspace_id: context.workspaceId, campaign_id: id })), { onConflict: "campaign_id,normalized_email", ignoreDuplicates: true })
        .select("id");
      if (insertError) failed += eligible.length; else added += inserted?.length ?? 0;
    }
    await db.from("email_campaign_events").insert([
      { workspace_id: context.workspaceId, campaign_id: id, event_type: "CAMPAIGN_CREATED" },
      { workspace_id: context.workspaceId, campaign_id: id, event_type: "AUDIENCE_IMPORTED", metadata: { source: "ASSISTANT", file: params.fileName, sourceRows: slice.length, addedRows: added, suppressedRows: suppressed, failedRows: failed } },
    ]);
    created.push(`${plan.name} (${added.toLocaleString("vi-VN")} người nhận${failed ? `, ${failed} lỗi` : ""})`);
  }
  revalidatePath("/campaigns");
  return { ok: true, message: `Đã tạo ${created.length} chiến dịch BẢN NHÁP: ${created.join("; ")}. Chưa gửi email nào; kiểm tra rồi khởi chạy trên trang Chiến dịch.`, link: "/campaigns" };
}

function partial(created: string[], reason: string): Executed {
  revalidatePath("/campaigns");
  return { ok: false, message: created.length ? `${reason} Đã tạo trước đó: ${created.join("; ")} (bản nháp, có thể xoá trên trang Chiến dịch).` : reason, link: "/campaigns" };
}
