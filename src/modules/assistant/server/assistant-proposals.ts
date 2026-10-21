import "server-only";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds, getAccessibleEmailAccountIds } from "@/modules/access/server/access-control";
import { isGroupConversation, isZaloGroupThread, metadataName, parseVietnamDue } from "@/modules/assistant/core/assistant-tools";
import { sendManualChannelMessage } from "@/modules/channels/server/channel-actions";
import { validateRenderedCampaignMessage } from "@/modules/campaigns/domain/campaign-rules";
import { CONTENT_DEPARTMENTS, CONTENT_FORMATS, CONTENT_LANGUAGES, contentBriefSchema } from "@/modules/content/core/content-options";
import { startContentBatch } from "@/modules/content/server/start-content-batch";
import { describeRule, MAX_RULES_PER_OWNER, ruleFromToolArgs, ruleSchema } from "@/modules/assistant/core/assistant-rules";
import {
  executeCreateCompany, executeCreateContact, executeNote, executeUpdateCompany, executeUpdateContact, executeUpdateTask,
  proposeCreateCompany, proposeCreateContact, proposeNote, proposeUpdateCompany, proposeUpdateContact, proposeUpdateTask,
} from "@/modules/assistant/server/assistant-proposals-crm";
import { executeEmailCampaigns, proposeEmailCampaigns } from "@/modules/assistant/server/assistant-proposals-campaigns";
import { executeBroadcast, proposeBroadcast } from "@/modules/assistant/server/assistant-proposals-broadcast";
import { executeInboxBulk, proposeInboxBulk } from "@/modules/assistant/server/assistant-proposals-inbox-bulk";
import { executeSaveDocument, proposeSaveDocument } from "@/modules/assistant/server/assistant-proposals-documents";
import { executeCancelEvent, executeCreateEvent, executeSetReminder, proposeCancelEvent, proposeCreateEvent, proposeSetReminder } from "@/modules/assistant/server/assistant-proposals-calendar";

// Phase 2 of Trợ lý HireX. A proposal is validated against current data, stored as an
// assistant_actions row with a human-readable preview, and shown as a card. Only when the same
// member presses "Xác nhận" does executeAssistantAction run — re-checking permission and state,
// with the same rules as the buttons in the web app. A reply (SEND_REPLY) goes through the same
// send path as the inbox composer, to one conversation, with text the member saw and could edit.
// Nothing here launches new campaigns, deletes data or turns AI Recruiter AUTO on (CREATE_EMAIL_CAMPAIGNS only makes drafts).

export type ActionKind = "CREATE_TASK" | "SET_LEAD_STATUS" | "CAMPAIGN_CONTROL" | "CREATE_CONTENT" | "AI_RECRUITER_SAFE_STOP" | "SEND_REPLY" | "CREATE_RULE"
  | "CREATE_CONTACT" | "UPDATE_CONTACT" | "ADD_NOTE" | "CREATE_COMPANY" | "UPDATE_COMPANY" | "UPDATE_TASK" | "CREATE_EMAIL_CAMPAIGNS"
  | "CREATE_EVENT" | "CANCEL_EVENT" | "SET_REMINDER" | "CREATE_BROADCAST" | "BULK_INBOX" | "SAVE_DOCUMENT";
/** editableText: the card shows this in a text box; the member's edited version is what runs. */
export interface ActionPreview { title: string; lines: string[]; warning?: string | null; link?: string | null; editableText?: string; editableKind?: "message" | "note" }
export interface ActionContext { workspaceId: string; userId: string; permissions: string[]; isAdmin: boolean; /** The Zalo chat (Trợ lý nick) the question came from, if any. */ zaloConversationId?: string | null }
export interface PendingAction { id: string; kind: ActionKind; preview: ActionPreview; expiresAt: string }

export type Built = { ok: true; kind: ActionKind; params: Record<string, unknown>; preview: ActionPreview } | { ok: false; error: string };
/** batchId: a content batch was started (the Zalo Trợ lý sends its result when it is ready). */
export type Executed = { ok: boolean; message: string; link?: string | null; batchId?: string };

const PERMISSION: Record<ActionKind, string> = {
  CREATE_TASK: "tasks.create",
  SET_LEAD_STATUS: "contacts.update",
  CAMPAIGN_CONTROL: "campaigns.launch",
  CREATE_CONTENT: "content.create",
  AI_RECRUITER_SAFE_STOP: "workspace.admin",
  SEND_REPLY: "inbox.reply",
  CREATE_RULE: "dashboard.view",
  CREATE_CONTACT: "contacts.create",
  UPDATE_CONTACT: "contacts.update",
  ADD_NOTE: "contacts.update",
  CREATE_COMPANY: "companies.create",
  UPDATE_COMPANY: "companies.update",
  UPDATE_TASK: "tasks.update",
  CREATE_EMAIL_CAMPAIGNS: "campaigns.create",
  // Lịch hẹn: every member has their own calendar.
  CREATE_EVENT: "*",
  CANCEL_EVENT: "*",
  SET_REMINDER: "*",
  CREATE_BROADCAST: "broadcasts.manage",
  BULK_INBOX: "inbox.update",
  SAVE_DOCUMENT: "documents.create",
};
const allowed = (kind: ActionKind, context: ActionContext) => PERMISSION[kind] === "*" || (PERMISSION[kind] === "workspace.admin" ? context.isAdmin : context.permissions.includes(PERMISSION[kind]));

const LEAD_LABELS: Record<string, string> = { NEW: "Mới", CONTACTED: "Đã liên hệ", ENGAGED: "Đang trao đổi", QUALIFIED: "Đủ điều kiện", OPPORTUNITY: "Cơ hội", WON: "Thành công", LOST: "Thất bại", DO_NOT_CONTACT: "Không liên hệ" };
const vnTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const label = (options: readonly { value: string; label: string }[], value: string) => options.find((item) => item.value === value)?.label ?? value;
const CHANNEL_PATH: Record<string, string> = { EMAIL: "/campaigns", ZALO: "/campaigns/omnichannel", FACEBOOK_PROFILE: "/campaigns/facebook-profile" };

// ---------------------------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------------------------

async function proposeTask(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const title = String(args.tieu_de).trim();
  const dueText = typeof args.han === "string" ? args.han : null;
  const dueAt = parseVietnamDue(dueText);
  if (dueText && !dueAt) return { ok: false, error: "Hạn không hợp lệ, cần dạng YYYY-MM-DD hoặc YYYY-MM-DD HH:mm." };
  const db = createPrivilegedClient();
  let assignee = { id: context.userId, name: "chính anh/chị" };
  if (typeof args.giao_cho === "string" && args.giao_cho.trim()) {
    const name = args.giao_cho.trim().replace(/[%_,()]/g, " ");
    const { data } = await db.from("profiles").select("id,full_name").eq("workspace_id", context.workspaceId).ilike("full_name", `%${name}%`).limit(6);
    const matches = data ?? [];
    const exact = matches.filter((row) => row.full_name.toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"));
    const pick = exact.length === 1 ? exact : matches;
    if (pick.length === 0) return { ok: false, error: `Không tìm thấy thành viên tên "${args.giao_cho}".` };
    if (pick.length > 1) return { ok: false, error: `Có nhiều thành viên khớp: ${pick.map((row) => row.full_name).join(", ")}. Hỏi lại người dùng muốn giao cho ai.` };
    assignee = { id: pick[0].id, name: pick[0].full_name };
  }
  let conversationId: string | null = null;
  if (typeof args.conversation_id === "string") {
    const { data } = await (await createClient()).from("omnichannel_conversations").select("id,channel_account_id").eq("workspace_id", context.workspaceId).eq("id", args.conversation_id).maybeSingle();
    const accessible = await getAccessibleChannelAccountIds();
    if (!data || (accessible && !accessible.includes(data.channel_account_id))) return { ok: false, error: "Không tìm thấy hội thoại hoặc không có quyền." };
    conversationId = data.id;
  }
  return {
    ok: true, kind: "CREATE_TASK",
    params: { title, dueAt, assigneeId: assignee.id, conversationId },
    preview: {
      title: "Tạo công việc",
      lines: [`Công việc: ${title}`, `Giao cho: ${assignee.name}`, `Hạn: ${dueAt ? vnTime(dueAt) : "không có"}`, ...(conversationId ? ["Gắn với hội thoại đang xem"] : [])],
      link: conversationId ? `/inbox/all/${conversationId}` : "/tasks",
    },
  };
}

async function proposeLead(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const { data: contact } = await (await createClient()).from("contacts").select("id,full_name,lead_status").eq("workspace_id", context.workspaceId).eq("id", String(args.contact_id)).maybeSingle();
  if (!contact) return { ok: false, error: "Không tìm thấy liên hệ." };
  const to = String(args.trang_thai_moi);
  if (contact.lead_status === to) return { ok: false, error: `Liên hệ đã ở trạng thái ${LEAD_LABELS[to] ?? to}.` };
  return {
    ok: true, kind: "SET_LEAD_STATUS",
    params: { contactId: contact.id, from: contact.lead_status, to },
    preview: { title: "Đổi trạng thái lead", lines: [`Liên hệ: ${contact.full_name}`, `Trạng thái: ${LEAD_LABELS[contact.lead_status] ?? contact.lead_status} → ${LEAD_LABELS[to] ?? to}`], link: `/contacts/${contact.id}` },
  };
}

async function emailSendersAllowed(db: ReturnType<typeof createPrivilegedClient>, workspaceId: string, campaignId: string) {
  const allowedIds = await getAccessibleEmailAccountIds();
  if (allowedIds === null) return true;
  const { data, error } = await db.from("email_campaign_senders").select("email_account_id").eq("workspace_id", workspaceId).eq("campaign_id", campaignId);
  return !error && (data ?? []).every((row) => allowedIds.includes(row.email_account_id));
}

async function proposeCampaign(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const channel = String(args.kenh);
  const pause = args.hanh_dong === "TAM_DUNG";
  const from = pause ? "RUNNING" : "PAUSED";
  const db = createPrivilegedClient();
  const id = String(args.campaign_id);
  let name: string;
  let status: string;
  let pending = 0;
  if (channel === "EMAIL") {
    const { data } = await db.from("email_campaigns").select("id,name,status,archived_at").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
    if (!data || data.archived_at) return { ok: false, error: "Không tìm thấy chiến dịch email." };
    if (!await emailSendersAllowed(db, context.workspaceId, id)) return { ok: false, error: "Tài khoản không có quyền với các hộp thư gửi của chiến dịch này." };
    ({ name, status } = data);
    if (!pause) pending = (await db.from("email_campaign_recipients").select("id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId).eq("campaign_id", id).eq("status", "PENDING")).count ?? 0;
  } else {
    const { data } = await db.from("channel_campaigns").select("id,name,status,archived_at,channel_campaign_steps(allowed_channels)").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
    const steps = (data?.channel_campaign_steps ?? []) as unknown as { allowed_channels: string[] }[];
    if (!data || data.archived_at || !steps.some((step) => step.allowed_channels?.includes(channel))) return { ok: false, error: "Không tìm thấy chiến dịch ở kênh này." };
    ({ name, status } = data);
    if (!pause) pending = (await db.from("channel_campaign_recipients").select("id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId).eq("campaign_id", id).eq("status", "ACTIVE")).count ?? 0;
  }
  if (status !== from) return { ok: false, error: pause ? `Chiến dịch đang ở trạng thái ${status}, chỉ tạm dừng được chiến dịch đang chạy.` : `Chiến dịch đang ở trạng thái ${status}, chỉ tiếp tục được chiến dịch đang tạm dừng.` };
  const path = channel === "EMAIL" ? `/campaigns/${id}` : `${CHANNEL_PATH[channel]}/${id}`;
  return {
    ok: true, kind: "CAMPAIGN_CONTROL",
    params: { channel, campaignId: id, from, to: pause ? "PAUSED" : "RUNNING" },
    preview: {
      title: pause ? "Tạm dừng chiến dịch" : "Tiếp tục chiến dịch",
      lines: [`Chiến dịch: ${name} (${channel === "EMAIL" ? "Email" : channel === "ZALO" ? "Zalo" : "Facebook cá nhân"})`, `Trạng thái: ${pause ? "Đang chạy → Tạm dừng" : "Tạm dừng → Đang chạy"}`],
      warning: pause ? null : `Chiến dịch sẽ gửi tiếp tới khoảng ${pending.toLocaleString("vi-VN")} người chưa nhận, theo giới hạn gửi đã cài.`,
      link: path,
    },
  };
}

function briefInput(args: Record<string, unknown>, templateIds: string[]) {
  const value = (key: string) => typeof args[key] === "string" ? String(args[key]) : "";
  return {
    jobTitle: value("ten_job"), position: value("vi_tri"), location: value("dia_diem"), languagesRequired: value("ngoai_ngu"),
    techSkills: value("ky_nang"), salary: value("luong"), highlights: value("diem_noi_bat"), jdText: value("mo_ta_jd"), blockedTerms: value("tu_khoa_cam"),
    style: { choice: "PROFESSIONAL", other: "" }, styleNote: "", sampleContent: "",
    contentLanguage: value("ngon_ngu"), contentFormat: value("dinh_dang"), department: value("bo_phan"),
    templateIds, quantity: args.so_luong,
  };
}

async function proposeContent(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const codes = (args.ma_mau as string[]).map((code) => code.trim()).filter(Boolean);
  let templateIds: string[] = [];
  if (codes.length) {
    const { data } = await (await createClient()).from("content_templates").select("id,code").eq("workspace_id", context.workspaceId).in("code", codes);
    const byCode = new Map(((data ?? []) as { id: string; code: string }[]).map((row) => [row.code, row.id]));
    const missing = codes.filter((code) => !byCode.has(code));
    if (missing.length) return { ok: false, error: `Không có mẫu: ${missing.join(", ")}. Dùng công cụ kho_mau_content để xem mã mẫu.` };
    templateIds = codes.map((code) => byCode.get(code)!);
  }
  const input = briefInput(args, templateIds);
  const parsed = contentBriefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Thông tin tạo content chưa hợp lệ (tên job 1–200 ký tự, số lượng 1–10…)." };
  const brief = parsed.data;
  const facts = [brief.position, brief.location, brief.languagesRequired, brief.salary, brief.techSkills, brief.highlights].filter(Boolean).join(" · ");
  return {
    ok: true, kind: "CREATE_CONTENT", params: { input },
    preview: {
      title: "Tạo content",
      lines: [
        `${label(CONTENT_DEPARTMENTS, brief.department)} · ${brief.jobTitle}`,
        ...(facts ? [`Dữ kiện: ${facts.slice(0, 300)}`] : []),
        `${brief.quantity} content · ${label(CONTENT_FORMATS, brief.contentFormat)} · ${label(CONTENT_LANGUAGES, brief.contentLanguage)}`,
        `Mẫu: ${codes.length ? codes.join(", ") : "hệ thống tự chọn"}`,
        ...(brief.blockedTerms ? [`Từ khóa cấm: ${brief.blockedTerms}`] : []),
      ],
      link: "/content",
    },
  };
}

async function proposeAiStop(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const db = createPrivilegedClient();
  const id = String(args.id);
  if (args.doi_tuong === "BOT") {
    const { data: bot } = await db.from("ai_recruiter_bots").select("id,name,enabled,mode").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
    if (!bot) return { ok: false, error: "Không tìm thấy bot." };
    const emergency = args.hanh_dong === "DUNG_KHAN_CAP";
    if (!emergency && bot.mode === "DRAFT") return { ok: false, error: "Bot đã ở chế độ DRAFT." };
    return {
      ok: true, kind: "AI_RECRUITER_SAFE_STOP", params: { target: "BOT", id, emergency },
      preview: {
        title: emergency ? "Dừng khẩn cấp bot AI Recruiter" : "Chuyển bot AI Recruiter sang DRAFT",
        lines: [`Bot: ${bot.name}`, `Hiện tại: ${bot.enabled ? "đang bật" : "đang tắt"}, ${bot.mode}`, emergency ? "Sau khi xác nhận: tắt bot, về DRAFT, tạm dừng mọi hội thoại và huỷ các lịch nhắc đang chờ" : "Sau khi xác nhận: AI chỉ soạn nháp, không tự gửi"],
        link: "/settings/ai-recruiter",
      },
    };
  }
  const { data: conversation } = await db.from("omnichannel_conversations").select("id,metadata").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
  if (!conversation) return { ok: false, error: "Không tìm thấy hội thoại." };
  const current = (conversation.metadata as Record<string, unknown> | null)?.aiRecruiterModeOverride;
  if (current === "DRAFT") return { ok: false, error: "Hội thoại đã ở chế độ DRAFT." };
  return {
    ok: true, kind: "AI_RECRUITER_SAFE_STOP", params: { target: "CONVERSATION", id },
    preview: { title: "Chuyển hội thoại sang DRAFT", lines: ["AI Recruiter chỉ soạn nháp cho hội thoại này, không tự gửi", `Hiện tại: ${typeof current === "string" ? current : "theo cài đặt bot"}`], link: `/inbox/all/${id}` },
  };
}

const REPLY_CHANNELS: Record<string, string> = { ZALO: "Zalo", FACEBOOK: "Facebook Page", FACEBOOK_PROFILE: "Facebook cá nhân" };
const FACEBOOK_WINDOW_MS = 24 * 3_600_000;
const clipLine = (value: string | null | undefined, max: number) => !value ? "" : value.length > max ? `${value.slice(0, max)}…` : value;

/** Same text rules as the inbox composer: trimmed, 1–100000 characters, no NUL. */
export function cleanReplyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  return text && text.length <= 100_000 && !text.includes("\u0000") ? text : null;
}

async function proposeReply(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const text = cleanReplyText(args.noi_dung);
  if (!text) return { ok: false, error: "Nội dung tin trống." };
  const db = createPrivilegedClient();
  const { data: conversation } = await (await createClient()).from("omnichannel_conversations")
    .select("id,channel_account_id,channel_type,provider_conversation_id,contact_id,metadata").eq("workspace_id", context.workspaceId).eq("id", String(args.conversation_id)).maybeSingle();
  const accessible = await getAccessibleChannelAccountIds();
  if (!conversation || (accessible && !accessible.includes(conversation.channel_account_id))) return { ok: false, error: "Không tìm thấy hội thoại hoặc tài khoản không có quyền dùng kênh của hội thoại này." };
  const channel = REPLY_CHANNELS[conversation.channel_type];
  if (!channel) return { ok: false, error: conversation.channel_type === "EMAIL" ? "Hội thoại email chưa gửi được qua trợ lý; hãy trả lời trực tiếp trong Suối Nguồn." : "Kênh của hội thoại này chưa hỗ trợ gửi qua trợ lý." };
  const [account, contact, lastInbound, pending, binding, recentSenders] = await Promise.all([
    db.from("channel_accounts").select("display_name,status").eq("workspace_id", context.workspaceId).eq("id", conversation.channel_account_id).maybeSingle(),
    conversation.contact_id ? db.from("contacts").select("full_name").eq("workspace_id", context.workspaceId).eq("id", conversation.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("omnichannel_messages").select("text_content,received_at,created_at").eq("workspace_id", context.workspaceId).eq("conversation_id", conversation.id).eq("direction", "INBOUND").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("channel_outbound_actions").select("id").eq("workspace_id", context.workspaceId).eq("conversation_id", conversation.id).eq("status", "APPROVED").eq("attempt_count", 0).limit(1),
    db.from("ai_recruiter_channel_bindings").select("enabled,ai_recruiter_bots!inner(enabled,mode)").eq("workspace_id", context.workspaceId).eq("channel_account_id", conversation.channel_account_id).maybeSingle(),
    db.from("omnichannel_messages").select("sender_external_id").eq("workspace_id", context.workspaceId).eq("conversation_id", conversation.id).eq("direction", "INBOUND").order("created_at", { ascending: false }).limit(30),
  ]);
  if ((pending.data ?? []).length) return { ok: false, error: "Hội thoại đang có một tin chờ gửi. Hãy xử lý tin đó trong Suối Nguồn trước." };
  if (account.data && account.data.status !== "CONNECTED") return { ok: false, error: `Tài khoản ${account.data.display_name ?? channel} đang không kết nối (${account.data.status}), chưa gửi được.` };
  const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
  const name = contact.data?.full_name ?? metadataName(metadata) ?? "khách (không rõ tên)";
  // Several different people writing in the conversation = a group chat.
  const senders = (recentSenders.data ?? []).map((row) => row.sender_external_id);
  const group = isGroupConversation(metadata) || new Set(senders).size > 1 || senders.some((sender) => isZaloGroupThread(conversation.channel_type, conversation.provider_conversation_id, sender));
  const inboundAt = lastInbound.data ? lastInbound.data.received_at ?? lastInbound.data.created_at : null;
  const bot = binding.data?.enabled ? binding.data.ai_recruiter_bots as unknown as { enabled: boolean; mode: string } | null : null;
  const aiAuto = Boolean(bot?.enabled) && metadata.aiRecruiterModeOverride !== "DRAFT" && (metadata.aiRecruiterModeOverride === "AUTO" || bot?.mode === "AUTO");
  const warnings = [
    group ? "Đây là NHÓM chat: tin sẽ hiện với mọi thành viên trong nhóm." : null,
    conversation.channel_type === "FACEBOOK" && (!inboundAt || Date.now() - Date.parse(inboundAt) > FACEBOOK_WINDOW_MS) ? "Facebook Page chỉ cho trả lời trong 24 giờ kể từ tin cuối của khách; tin có thể bị từ chối." : null,
    aiAuto ? "AI Recruiter đang tự trả lời (AUTO) ở hội thoại này; hãy chắc tin của anh/chị không trùng với tin của AI." : null,
  ].filter(Boolean);
  return {
    ok: true, kind: "SEND_REPLY",
    params: { conversationId: conversation.id, idempotencyKey: randomUUID(), text },
    preview: {
      title: "Gửi trả lời",
      lines: [
        `Gửi cho: ${name}${group ? " (nhóm)" : ""}`,
        `Qua: ${channel}${account.data?.display_name ? ` · ${account.data.display_name}` : ""}`,
        ...(lastInbound.data?.text_content ? [`Tin cuối của khách: “${clipLine(lastInbound.data.text_content.replace(/\s+/g, " "), 160)}”`] : []),
        "Nội dung gửi (sửa được trước khi xác nhận):",
      ],
      warning: warnings.length ? warnings.join(" ") : null,
      link: `/inbox/all/${conversation.id}`,
      editableText: text,
    },
  };
}

async function proposeRule(args: Record<string, unknown>, context: ActionContext): Promise<Built> {
  const checked = ruleFromToolArgs(args, context.isAdmin);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { count } = await createPrivilegedClient().from("assistant_rules").select("id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId).eq("created_by", context.userId);
  if ((count ?? 0) >= MAX_RULES_PER_OWNER) return { ok: false, error: `Mỗi người tối đa ${MAX_RULES_PER_OWNER} quy tắc. Hãy xóa bớt ở trang Quy tắc tự động.` };
  return {
    ok: true, kind: "CREATE_RULE", params: { name: checked.name, rule: checked.rule },
    preview: { title: "Tạo quy tắc tự động", lines: [`Tên: ${checked.name}`, ...describeRule(checked.rule)], link: "/assistant/rules" },
  };
}

const BUILDERS: Record<string, (args: Record<string, unknown>, context: ActionContext) => Promise<Built>> = {
  de_xuat_tao_cong_viec: proposeTask,
  de_xuat_doi_trang_thai_lead: proposeLead,
  de_xuat_dieu_khien_chien_dich: proposeCampaign,
  de_xuat_tao_content: proposeContent,
  de_xuat_dung_ai_recruiter: proposeAiStop,
  de_xuat_tra_loi_hoi_thoai: proposeReply,
  de_xuat_tao_quy_tac: proposeRule,
  de_xuat_tao_lien_he: proposeCreateContact,
  de_xuat_sua_lien_he: proposeUpdateContact,
  de_xuat_ghi_chu_lien_he: proposeNote,
  de_xuat_tao_cong_ty: proposeCreateCompany,
  de_xuat_sua_cong_ty: proposeUpdateCompany,
  de_xuat_cap_nhat_cong_viec: proposeUpdateTask,
  de_xuat_tao_chien_dich_email: proposeEmailCampaigns,
  de_xuat_tao_lich_hen: proposeCreateEvent,
  de_xuat_huy_lich_hen: proposeCancelEvent,
  de_xuat_cai_nhac_lich: proposeSetReminder,
  de_xuat_nhap_gui_nhom: proposeBroadcast,
  de_xuat_thao_tac_hang_loat: proposeInboxBulk,
  de_xuat_luu_tai_lieu: proposeSaveDocument,
};

export const MAX_PROPOSALS_PER_QUESTION = 3;
const REPLY_TOOL = "de_xuat_tra_loi_hoi_thoai";

// The model may call several proposal tools in parallel in one round, so the limits below are
// reserved synchronously (before any await) per question, not only checked against finished cards.
const reservations = new WeakMap<PendingAction[], { slots: number; reply: boolean }>();

/** Validates a proposal and stores it; returns what the model is told. */
export async function createProposal(toolName: string, args: Record<string, unknown>, context: ActionContext, collected: PendingAction[]): Promise<unknown> {
  const builder = BUILDERS[toolName];
  if (!builder) return { loi: "Không hỗ trợ thao tác này." };
  const reserved = reservations.get(collected) ?? { slots: 0, reply: false };
  reservations.set(collected, reserved);
  if (reserved.slots >= MAX_PROPOSALS_PER_QUESTION) return { loi: `Tối đa ${MAX_PROPOSALS_PER_QUESTION} đề xuất mỗi câu hỏi.` };
  // One reply card per question: a reply always goes to exactly one person the member chose.
  const isReply = toolName === REPLY_TOOL;
  if (isReply && reserved.reply) return { loi: "Mỗi câu hỏi chỉ đề xuất gửi 1 tin cho 1 người. Không tạo thêm thẻ; hãy nói người dùng hỏi lại riêng cho người tiếp theo." };
  reserved.slots += 1;
  if (isReply) reserved.reply = true;
  const release = () => { reserved.slots -= 1; if (isReply) reserved.reply = false; };
  let built: Built;
  try { built = await builder(args, context); } catch (error) { release(); throw error; }
  if (!built.ok) { release(); return { khong_tao_duoc_de_xuat: built.error }; }
  if (!allowed(built.kind, context)) { release(); return { loi: "Tài khoản không có quyền thao tác này." }; }
  const { data, error } = await createPrivilegedClient().from("assistant_actions")
    .insert({ workspace_id: context.workspaceId, user_id: context.userId, kind: built.kind, params: built.params, preview: built.preview })
    .select("id,expires_at").single();
  if (error || !data) { release(); return { loi: "Không lưu được đề xuất." }; }
  collected.push({ id: data.id, kind: built.kind, preview: built.preview, expiresAt: data.expires_at });
  return {
    da_tao_the_xac_nhan: true, tieu_de: built.preview.title, chi_tiet: built.preview.lines, canh_bao: built.preview.warning ?? null,
    ghi_chu: built.kind === "SEND_REPLY"
      ? "Chưa gửi. Thẻ đã hiện nội dung tin; người dùng có thể sửa rồi bấm Xác nhận trong vòng 15 phút. Không chép lại toàn bộ nội dung tin trong câu trả lời."
      : "Chưa thực hiện. Người dùng phải bấm Xác nhận trên thẻ trong vòng 15 phút.",
  };
}

// ---------------------------------------------------------------------------------------------
// Execution (after the member presses "Xác nhận")
// ---------------------------------------------------------------------------------------------

async function executeTask(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const { error } = await createPrivilegedClient().from("channel_tasks").insert({
    workspace_id: context.workspaceId, title: String(params.title), status: "OPEN", assigned_to: params.assigneeId, due_at: params.dueAt ?? null,
    conversation_id: params.conversationId ?? null, created_by: context.userId,
  });
  if (error) return { ok: false, message: "Không tạo được công việc." };
  revalidatePath("/tasks");
  return { ok: true, message: `Đã tạo công việc “${String(params.title).slice(0, 80)}”.`, link: "/tasks" };
}

async function executeLead(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const { data, error } = await (await createClient()).from("contacts").update({ lead_status: params.to })
    .eq("workspace_id", context.workspaceId).eq("id", String(params.contactId)).eq("lead_status", String(params.from)).select("id,full_name");
  if (error) return { ok: false, message: "Không đổi được trạng thái (có thể thiếu quyền Sửa liên hệ)." };
  if (!data?.length) return { ok: false, message: "Trạng thái liên hệ đã bị thay đổi trước đó. Hãy hỏi lại để xem trạng thái mới." };
  revalidatePath("/contacts");
  return { ok: true, message: `Đã đổi ${data[0].full_name} sang ${LEAD_LABELS[String(params.to)] ?? params.to}.`, link: `/contacts/${params.contactId}` };
}

async function executeCampaign(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const db = createPrivilegedClient();
  const id = String(params.campaignId);
  const pause = params.to === "PAUSED";
  const changed = "Chiến dịch đã đổi trạng thái trước đó. Hãy hỏi lại để xem trạng thái mới.";
  if (params.channel === "EMAIL") {
    if (!await emailSendersAllowed(db, context.workspaceId, id)) return { ok: false, message: "Không có quyền với hộp thư gửi của chiến dịch." };
    if (!pause) {
      // Same checks as the "Tiếp tục" button: valid message, recipients, a connected Gmail sender.
      const { data: campaign } = await db.from("email_campaigns").select("subject_template,body_text_template").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
      if (!campaign || validateRenderedCampaignMessage(campaign.subject_template, campaign.body_text_template)) return { ok: false, message: "Nội dung chiến dịch chưa hợp lệ, hãy mở chiến dịch để kiểm tra." };
      const [{ count }, { data: senders }] = await Promise.all([
        db.from("email_campaign_recipients").select("id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId).eq("campaign_id", id),
        db.from("email_campaign_senders").select("id,email_accounts!inner(status,provider,scopes)").eq("workspace_id", context.workspaceId).eq("campaign_id", id).eq("enabled", true),
      ]);
      const hasSender = (senders ?? []).some((sender) => { const account = sender.email_accounts as unknown as { status: string; provider: string; scopes: string[] }; return account.status === "CONNECTED" && account.provider === "GMAIL" && account.scopes.includes("https://www.googleapis.com/auth/gmail.send"); });
      if (!count || !hasSender) return { ok: false, message: "Chiến dịch chưa có người nhận hoặc không còn hộp thư gửi nào đang kết nối." };
    }
    const now = new Date().toISOString();
    const patch = pause ? { status: "PAUSED", paused_at: now } : { status: "RUNNING", started_at: now, paused_at: null };
    const { data } = await db.from("email_campaigns").update(patch).eq("workspace_id", context.workspaceId).eq("id", id).eq("status", String(params.from)).select("id").maybeSingle();
    if (!data) return { ok: false, message: changed };
    if (!pause) await db.rpc("initialize_email_campaign_sequence", { p_workspace_id: context.workspaceId, p_campaign_id: id });
    await db.from("email_campaign_events").insert({ workspace_id: context.workspaceId, campaign_id: id, event_type: pause ? "CAMPAIGN_PAUSED" : "CAMPAIGN_RESUMED" });
    revalidatePath(`/campaigns/${id}`); revalidatePath("/campaigns");
    return { ok: true, message: pause ? "Đã tạm dừng chiến dịch email." : "Đã tiếp tục chiến dịch email.", link: `/campaigns/${id}` };
  }
  const { data } = await db.from("channel_campaigns").update({ status: params.to }).eq("workspace_id", context.workspaceId).eq("id", id).eq("status", String(params.from)).is("archived_at", null).select("id").maybeSingle();
  if (!data) return { ok: false, message: changed };
  await db.from("channel_campaign_events").insert({ workspace_id: context.workspaceId, campaign_id: id, event_type: pause ? "PAUSED" : "RESUMED" });
  const path = `${CHANNEL_PATH[String(params.channel)]}/${id}`;
  revalidatePath(path); revalidatePath(CHANNEL_PATH[String(params.channel)]);
  return { ok: true, message: pause ? "Đã tạm dừng chiến dịch." : "Đã tiếp tục chiến dịch.", link: path };
}

async function executeContent(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const parsed = contentBriefSchema.safeParse(params.input);
  if (!parsed.success) return { ok: false, message: "Thông tin tạo content không còn hợp lệ." };
  const started = await startContentBatch(context, parsed.data);
  if (!started.ok) return { ok: false, message: started.message };
  return { ok: true, message: `Đang tạo ${parsed.data.quantity} content cho “${parsed.data.jobTitle}”. Kết quả hiện trong Kho content sau 1–2 phút.`, link: "/content", batchId: started.batchId };
}

async function executeAiStop(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const db = createPrivilegedClient();
  const id = String(params.id);
  if (params.target === "BOT") {
    if (params.emergency) {
      const now = new Date().toISOString();
      const { data: bot } = await db.from("ai_recruiter_bots").update({ enabled: false, mode: "DRAFT", mode_change_actor: context.userId }).eq("workspace_id", context.workspaceId).eq("id", id).select("id").maybeSingle();
      if (!bot) return { ok: false, message: "Không tìm thấy bot." };
      await Promise.all([
        db.from("ai_recruiter_conversation_states").update({ bot_paused: true, pause_reason: "EMERGENCY_STOP", next_followup_at: null }).eq("workspace_id", context.workspaceId).eq("bot_id", id),
        db.from("ai_recruiter_scheduled_actions").update({ status: "CANCELLED", completed_at: now }).eq("workspace_id", context.workspaceId).eq("bot_id", id).in("status", ["PENDING", "CLAIMED"]),
      ]);
      revalidatePath("/settings/ai-recruiter");
      return { ok: true, message: "Đã dừng khẩn cấp bot.", link: "/settings/ai-recruiter" };
    }
    const { data } = await db.from("ai_recruiter_bots").update({ mode: "DRAFT", mode_change_actor: context.userId }).eq("workspace_id", context.workspaceId).eq("id", id).select("id").maybeSingle();
    if (!data) return { ok: false, message: "Không tìm thấy bot." };
    revalidatePath("/settings/ai-recruiter");
    return { ok: true, message: "Đã chuyển bot sang DRAFT.", link: "/settings/ai-recruiter" };
  }
  const { data: conversation } = await db.from("omnichannel_conversations").select("id,metadata").eq("workspace_id", context.workspaceId).eq("id", id).maybeSingle();
  if (!conversation) return { ok: false, message: "Không tìm thấy hội thoại." };
  const metadata = conversation.metadata && typeof conversation.metadata === "object" && !Array.isArray(conversation.metadata) ? conversation.metadata as Record<string, unknown> : {};
  await db.from("omnichannel_conversations").update({ metadata: { ...metadata, aiRecruiterModeOverride: "DRAFT", aiRecruiterModeChangedBy: context.userId } }).eq("workspace_id", context.workspaceId).eq("id", id);
  await db.from("ai_recruiter_conversation_states").update({ next_followup_at: null }).eq("workspace_id", context.workspaceId).eq("conversation_id", id);
  revalidatePath(`/inbox/all/${id}`);
  return { ok: true, message: "Đã chuyển hội thoại sang DRAFT.", link: `/inbox/all/${id}` };
}

// English messages of the shared send action, in the words the member sees elsewhere.
const SEND_MESSAGES: Record<string, string> = {
  "This message was already sent once.": "Tin này đã được gửi trước đó, không gửi lại.",
  "Policy blocked this message or the channel is unavailable.": "Chính sách gửi đã chặn tin này hoặc kênh đang không khả dụng (ví dụ người nhận đã từ chối nhận tin). Tin chưa được gửi.",
  "The message failed its final policy check and was not sent.": "Tin không qua bước kiểm tra cuối nên chưa được gửi.",
};

async function executeReply(params: Record<string, unknown>): Promise<Executed> {
  const text = cleanReplyText(params.text);
  if (!text) return { ok: false, message: "Nội dung tin trống." };
  const form = new FormData();
  form.set("conversationId", String(params.conversationId));
  form.set("idempotencyKey", String(params.idempotencyKey));
  form.set("text", text);
  const result = await sendManualChannelMessage({ status: "idle", message: null }, form);
  const raw = result.message ?? "";
  const message = SEND_MESSAGES[raw] ?? (/[À-ỹ]/.test(raw) ? raw : result.status === "success" ? "Đã gửi tin." : "Tin chưa được gửi. Hãy mở hội thoại để kiểm tra trạng thái trước khi gửi lại.");
  return { ok: result.status === "success", message, link: `/inbox/all/${params.conversationId}` };
}

async function executeRule(params: Record<string, unknown>, context: ActionContext): Promise<Executed> {
  const rule = ruleSchema.safeParse(params.rule);
  const name = typeof params.name === "string" ? params.name.trim().slice(0, 120) : "";
  if (!rule.success || !name) return { ok: false, message: "Quy tắc không còn hợp lệ." };
  if (!context.isAdmin && rule.data.target !== "OWNER") return { ok: false, message: "Chỉ quản trị viên được đặt quy tắc báo cho người khác." };
  const { error } = await createPrivilegedClient().from("assistant_rules").insert({ workspace_id: context.workspaceId, created_by: context.userId, name, definition: rule.data });
  if (error) return { ok: false, message: "Không lưu được quy tắc." };
  revalidatePath("/assistant/rules");
  return { ok: true, message: `Đã bật quy tắc “${name}”. Hệ thống kiểm tra 5 phút một lần.`, link: "/assistant/rules" };
}

const EXECUTORS: Record<ActionKind, (params: Record<string, unknown>, context: ActionContext) => Promise<Executed>> = {
  CREATE_TASK: executeTask,
  SET_LEAD_STATUS: executeLead,
  CAMPAIGN_CONTROL: executeCampaign,
  CREATE_CONTENT: executeContent,
  AI_RECRUITER_SAFE_STOP: executeAiStop,
  SEND_REPLY: executeReply,
  CREATE_RULE: executeRule,
  CREATE_CONTACT: executeCreateContact,
  UPDATE_CONTACT: executeUpdateContact,
  ADD_NOTE: executeNote,
  CREATE_COMPANY: executeCreateCompany,
  UPDATE_COMPANY: executeUpdateCompany,
  UPDATE_TASK: executeUpdateTask,
  CREATE_EMAIL_CAMPAIGNS: executeEmailCampaigns,
  CREATE_EVENT: executeCreateEvent,
  CANCEL_EVENT: executeCancelEvent,
  SET_REMINDER: executeSetReminder,
  CREATE_BROADCAST: executeBroadcast,
  BULK_INBOX: executeInboxBulk,
  SAVE_DOCUMENT: executeSaveDocument,
};

/** Confirms or cancels one of the member's own proposals. Runs it at most once. */
export async function decideAssistantAction(actionId: string, decision: "confirm" | "cancel", context: ActionContext, edits: { text?: string } = {}): Promise<Executed> {
  const db = createPrivilegedClient();
  const now = new Date().toISOString();
  const { data: row } = await db.from("assistant_actions").select("id,kind,params,status,expires_at")
    .eq("workspace_id", context.workspaceId).eq("user_id", context.userId).eq("id", actionId).maybeSingle();
  if (!row) return { ok: false, message: "Không tìm thấy đề xuất." };
  if (row.status !== "PROPOSED") return { ok: false, message: "Đề xuất này đã được xử lý." };
  if (decision === "cancel") {
    await db.from("assistant_actions").update({ status: "CANCELLED", decided_at: now, finished_at: now }).eq("id", row.id).eq("status", "PROPOSED");
    return { ok: true, message: "Đã huỷ đề xuất." };
  }
  if (Date.parse(row.expires_at) < Date.now()) {
    await db.from("assistant_actions").update({ status: "EXPIRED", decided_at: now, finished_at: now }).eq("id", row.id).eq("status", "PROPOSED");
    return { ok: false, message: "Đề xuất đã hết hạn (15 phút). Hãy hỏi trợ lý tạo lại." };
  }
  const kind = row.kind as ActionKind;
  if (!allowed(kind, context)) return { ok: false, message: "Tài khoản không còn quyền thực hiện thao tác này." };
  let params = row.params as Record<string, unknown>;
  // Only a reply's text can be edited on the card; the recipient and everything else stay as proposed.
  if (kind === "SEND_REPLY" && edits.text !== undefined) {
    const text = cleanReplyText(edits.text);
    if (!text) return { ok: false, message: "Nội dung tin trống hoặc quá dài." };
    params = { ...params, text, editedByMember: text !== params.text };
  }
  // The text of a draft group broadcast can be edited on the card too.
  if (kind === "CREATE_BROADCAST" && edits.text !== undefined) {
    const text = edits.text.trim();
    if (!text || text.length > (params.pinNote === true ? 2000 : 4000)) return { ok: false, message: "Nội dung trống hoặc quá dài." };
    params = { ...params, text };
  }
  // A note's text can be edited on the card too.
  if (kind === "ADD_NOTE" && edits.text !== undefined) {
    const content = edits.text.trim().slice(0, 5000);
    if (!content) return { ok: false, message: "Ghi chú trống." };
    params = { ...params, content };
  }
  const { data: claimed } = await db.from("assistant_actions").update({ status: "EXECUTING", decided_at: now, params }).eq("id", row.id).eq("status", "PROPOSED").select("id").maybeSingle();
  if (!claimed) return { ok: false, message: "Đề xuất này đã được xử lý." };
  let result: Executed;
  try {
    result = await EXECUTORS[kind](params, context);
  } catch {
    result = { ok: false, message: "Có lỗi khi thực hiện. Vui lòng kiểm tra lại trên trang." };
  }
  await db.from("assistant_actions").update({ status: result.ok ? "EXECUTED" : "FAILED", result_message: result.message.slice(0, 1000), finished_at: new Date().toISOString() }).eq("id", row.id);
  return result;
}
