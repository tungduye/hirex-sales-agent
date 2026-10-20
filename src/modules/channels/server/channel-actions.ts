"use server";

import { parseMentions } from "@/modules/channels/core/zalo-mentions";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { ChannelActionState } from "../types/channel-action-state";
import { randomUUID } from "node:crypto";
import { dispatchManualFacebookAction } from "./dispatch-manual-facebook-action";
import { dispatchManualZaloAction } from "./dispatch-manual-zalo-action";
import { dispatchManualFacebookProfileAction } from "./dispatch-manual-facebook-profile-action";
import { reconcileZaloDeliveryUnknown } from "./reconcile-zalo-delivery-unknown";
import { canAccessChannelAccount, hasPermission } from "@/modules/access/server/access-control";
import { createPrivilegedClient } from "@/lib/supabase/privileged";

const uuid = z.string().uuid();
const conversationControlSchema = z.object({
  conversationId: uuid,
  status: z.enum(["OPEN", "PENDING", "RESOLVED", "SPAM"]),
  takeoverMode: z.enum(["BOT_ALLOWED", "HUMAN_TAKEOVER"]),
  assignedTo: z.union([uuid, z.literal("")]),
});
const tagSchema = z.object({ name: z.string().trim().min(1).max(80), color: z.union([z.string().regex(/^#[0-9A-Fa-f]{6}$/), z.literal("")]) });
const tagLinkSchema = z.object({ conversationId: uuid, tagId: uuid, enabled: z.enum(["true", "false"]) });
const quickReplySchema = z.object({
  id: z.union([uuid, z.literal("")]), name: z.string().trim().min(1).max(100), shortcut: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/),
  textContent: z.string().trim().min(1).max(100_000), channelTypes: z.array(z.enum(["EMAIL","FACEBOOK","FACEBOOK_PROFILE","ZALO","WHATSAPP","VIBER","TELEGRAM","OTHER"])).max(8),
});
const automationSchema = z.object({
  id: z.union([uuid, z.literal("")]), name: z.string().trim().min(1).max(120), enabled: z.enum(["true", "false"]),
  triggerType: z.enum(["MESSAGE_RECEIVED","KEYWORD_MATCHED","TAG_ADDED","CONVERSATION_ASSIGNED","SCHEDULED"]),
  keywords: z.string().max(2000), actionType: z.enum(["ADD_TAG","REMOVE_TAG","ASSIGN_CONVERSATION","SET_CONVERSATION_STATUS","PROPOSE_MESSAGE","CREATE_TASK"]),
  actionConfiguration: z.string().max(10000),
});
const suppressionSchema = z.object({ channelType: z.enum(["EMAIL","FACEBOOK","ZALO","WHATSAPP","VIBER","TELEGRAM","OTHER"]), recipient: z.string().trim().min(1).max(512).refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value)) });

async function authenticatedClient() {
  const account = await getAccountContext();
  if (!account?.configurationComplete || !account.workspaceId) return null;
  return createClient();
}

export async function updateConversationControls(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = conversationControlSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa cập nhật được hội thoại. Vui lòng thử lại." };
  if (!await hasPermission("inbox.update")) return { status: "error", message: "Bạn không có quyền cập nhật hội thoại." };
  const { data: conversation, error: lookupError } = await supabase.from("omnichannel_conversations")
    .select("id,channel_account_id").eq("id", parsed.data.conversationId).maybeSingle();
  if (lookupError || !conversation || !await canAccessChannelAccount(conversation.channel_account_id)) return { status: "error", message: "Bạn không có quyền truy cập hội thoại này." };
  const { data, error } = await supabase.rpc("set_omnichannel_conversation_controls", { p_conversation_id: parsed.data.conversationId, p_status: parsed.data.status, p_takeover_mode: parsed.data.takeoverMode, p_assigned_to: parsed.data.assignedTo || null });
  if (error || data !== true) return { status: "error", message: "Chưa cập nhật được hội thoại." };
  revalidatePath("/inbox/all");
  return { status: "success", message: "Đã cập nhật hội thoại." };
}

export async function createConversationTag(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = tagSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa tạo được nhãn (có thể tên nhãn đã tồn tại)." };
  if (!await hasPermission("inbox.update")) return { status: "error", message: "Bạn không có quyền cập nhật hội thoại." };
  const { data, error } = await supabase.rpc("create_conversation_tag", { p_name: parsed.data.name, p_color: parsed.data.color || null });
  if (error || typeof data !== "string") return { status: "error", message: "Chưa tạo được nhãn (có thể tên nhãn đã tồn tại)." };
  revalidatePath("/inbox/all");
  return { status: "success", message: "Đã tạo nhãn." };
}

export async function setConversationTag(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = tagLinkSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa đổi được nhãn." };
  if (!await hasPermission("inbox.update")) return { status: "error", message: "Bạn không có quyền cập nhật hội thoại." };
  const { data: conversation, error: lookupError } = await supabase.from("omnichannel_conversations")
    .select("id,channel_account_id").eq("id", parsed.data.conversationId).maybeSingle();
  if (lookupError || !conversation || !await canAccessChannelAccount(conversation.channel_account_id)) return { status: "error", message: "Bạn không có quyền truy cập hội thoại này." };
  const { data, error } = await supabase.rpc("set_conversation_tag", { p_conversation_id: parsed.data.conversationId, p_tag_id: parsed.data.tagId, p_enabled: parsed.data.enabled === "true" });
  if (error || data !== true) return { status: "error", message: "Chưa đổi được nhãn." };
  revalidatePath("/inbox/all");
  return { status: "success", message: "Đã cập nhật nhãn." };
}

export async function saveQuickReply(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = quickReplySchema.safeParse({ ...Object.fromEntries(formData), channelTypes: formData.getAll("channelTypes") });
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa lưu được câu trả lời nhanh." };
  if (!await hasPermission("channels.manage")) return { status: "error", message: "Bạn không có quyền quản lý kênh kết nối." };
  const { data, error } = await supabase.rpc("save_quick_reply_template", { p_id: parsed.data.id || null, p_name: parsed.data.name, p_shortcut: parsed.data.shortcut, p_text_content: parsed.data.textContent, p_channel_types: parsed.data.channelTypes });
  if (error || typeof data !== "string") return { status: "error", message: "Chưa lưu được câu trả lời nhanh." };
  revalidatePath("/settings/channels");
  return { status: "success", message: "Đã lưu câu trả lời nhanh." };
}

export async function deleteQuickReply(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("id"));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa xóa được câu trả lời nhanh." };
  if (!await hasPermission("channels.manage")) return { status: "error", message: "Bạn không có quyền quản lý kênh kết nối." };
  const { data, error } = await supabase.rpc("delete_quick_reply_template", { p_id: parsed.data });
  if (error || data !== true) return { status: "error", message: "Chưa xóa được câu trả lời nhanh." };
  revalidatePath("/settings/channels");
  return { status: "success", message: "Đã xóa câu trả lời nhanh." };
}

export async function saveChannelAutomation(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = automationSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa lưu được tự động hóa." };
  if (!await hasPermission("channels.manage")) return { status: "error", message: "Bạn không có quyền quản lý kênh kết nối." };
  let configuration: unknown;
  try { configuration = JSON.parse(parsed.data.actionConfiguration || "{}"); } catch { return { status: "error", message: "Cấu hình hành động phải là JSON hợp lệ." }; }
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return { status: "error", message: "Cấu hình hành động phải là một đối tượng JSON." };
  const keywords = [...new Set(parsed.data.keywords.split(/[;,\n]/u).map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (parsed.data.triggerType === "KEYWORD_MATCHED" && keywords.length === 0) return { status: "error", message: "Cần ít nhất một từ khóa." };
  const triggerConfig = parsed.data.triggerType === "KEYWORD_MATCHED" ? { keywords } : {};
  const { data, error } = await supabase.rpc("save_channel_automation", { p_id: parsed.data.id || null, p_name: parsed.data.name, p_enabled: parsed.data.enabled === "true", p_trigger_type: parsed.data.triggerType, p_trigger_config: triggerConfig, p_actions: [{ type: parsed.data.actionType, configuration }] });
  if (error || typeof data !== "string") return { status: "error", message: "Chưa lưu được tự động hóa." };
  revalidatePath("/settings/channels/automations");
  return { status: "success", message: "Đã lưu tự động hóa." };
}

export async function createManualChannelSuppression(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = suppressionSchema.safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa chặn được người nhận." };
  if (!await hasPermission("channels.manage")) return { status: "error", message: "Bạn không có quyền quản lý kênh kết nối." };
  const { data, error } = await supabase.rpc("save_manual_channel_suppression", { p_channel_type: parsed.data.channelType, p_normalized_recipient: parsed.data.recipient.toLowerCase() });
  if (error || typeof data !== "string") return { status: "error", message: "Người nhận đã bị chặn trước đó hoặc không còn." };
  revalidatePath("/settings/channels/suppressions");
  return { status: "success", message: "Đã chặn người nhận." };
}

export async function deleteManualChannelSuppression(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("id"));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa bỏ chặn được người nhận." };
  if (!await hasPermission("channels.manage")) return { status: "error", message: "Bạn không có quyền quản lý kênh kết nối." };
  const { data, error } = await supabase.rpc("delete_manual_channel_suppression", { p_id: parsed.data });
  if (error || data !== true) return { status: "error", message: "Chỉ bỏ chặn được người nhận do nhân viên chặn tay." };
  revalidatePath("/settings/channels/suppressions");
  return { status: "success", message: "Đã bỏ chặn người nhận." };
}

export async function proposeChannelMessage(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = z.object({ conversationId: uuid, text: z.string().trim().min(1).max(100000).refine((value) => !value.includes("\u0000")), proposedBy: z.enum(["HUMAN","AI_ASSIST"]).default("HUMAN") }).safeParse(Object.fromEntries(formData));
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase) return { status: "error", message: "Chưa tạo được bản nháp." };
  if (!await hasPermission("inbox.reply")) return { status: "error", message: "Bạn không có quyền trả lời hội thoại." };
  const { data: conversation, error: lookupError } = await supabase.from("omnichannel_conversations")
    .select("id,channel_account_id").eq("id", parsed.data.conversationId).maybeSingle();
  if (lookupError || !conversation || !await canAccessChannelAccount(conversation.channel_account_id)) return { status: "error", message: "Bạn không có quyền truy cập hội thoại này." };
  const { data, error } = await supabase.rpc("propose_channel_message", { p_conversation_id: parsed.data.conversationId, p_text_content: parsed.data.text, p_idempotency_key: randomUUID(), p_proposed_by: parsed.data.proposedBy });
  if (error || typeof data !== "string") return { status: "error", message: "Chính sách gửi đã chặn tin này hoặc kênh đang không khả dụng (ví dụ người nhận đã từ chối nhận tin). Tin chưa được gửi." };
  revalidatePath("/inbox/all");
  return { status: "success", message: "Đã tạo bản nháp. Hãy xem và duyệt trước khi gửi." };
}

export async function sendManualChannelMessage(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = z.object({ conversationId: uuid, idempotencyKey: uuid, text: z.string().trim().min(1).max(100000).refine((value) => !value.includes("\u0000")) }).safeParse(Object.fromEntries(formData));
  const account = await getAccountContext();
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase || !account?.workspaceId) return { status: "error", message: "Không thể gửi tin nhắn." };
  if(!await hasPermission("inbox.reply"))return {status:"error",message:"Tài khoản của bạn không có quyền trả lời hội thoại."};
  const {data:conversation}=await createPrivilegedClient().from("omnichannel_conversations").select("channel_account_id").eq("id",parsed.data.conversationId).eq("workspace_id",account.workspaceId).maybeSingle();
  if(!conversation||!await canAccessChannelAccount(conversation.channel_account_id))return {status:"error",message:"Bạn chưa được cấp quyền sử dụng tài khoản kết nối của hội thoại này."};
  const { data: existingPending, error: pendingError } = await supabase.from("channel_outbound_actions").select("id")
    .eq("workspace_id", account.workspaceId).eq("conversation_id", parsed.data.conversationId)
    .eq("status", "APPROVED").eq("attempt_count", 0).limit(1);
  if (pendingError) return { status: "error", message: "Không thể kiểm tra tin đang chờ. Hệ thống không tạo yêu cầu mới." };
  if ((existingPending ?? []).length > 0) return { status: "error", message: "Một tin trước đó vẫn đang chờ. Hãy xử lý tin đó thay vì tạo bản trùng." };
  const { data: existingRequest, error: existingRequestError } = await supabase.from("channel_outbound_actions")
    .select("id,status,attempt_count").eq("workspace_id", account.workspaceId)
    .eq("conversation_id", parsed.data.conversationId).eq("idempotency_key", parsed.data.idempotencyKey).maybeSingle();
  if (existingRequestError) return { status: "error", message: "Chưa kiểm tra được tin trùng. Chưa tạo lệnh gửi mới." };
  if (existingRequest) return existingRequest.status === "SENT"
    ? { status: "success", message: "Tin này đã được gửi trước đó, không gửi lại." }
    : { status: "error", message: "Yêu cầu gửi này đã có. Hãy kiểm tra trạng thái; không tạo tin trùng." };
  const { data: actionId, error: proposalError } = await supabase.rpc("propose_channel_message", {
    p_conversation_id: parsed.data.conversationId,
    p_text_content: parsed.data.text,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_proposed_by: "HUMAN",
  });
  if (proposalError || typeof actionId !== "string") {
    const { data: racedRequest } = await supabase.from("channel_outbound_actions").select("status")
      .eq("workspace_id", account.workspaceId).eq("conversation_id", parsed.data.conversationId)
      .eq("idempotency_key", parsed.data.idempotencyKey).maybeSingle();
    if (racedRequest) return racedRequest.status === "SENT"
      ? { status: "success", message: "Tin này đã được gửi trước đó, không gửi lại." }
      : { status: "error", message: "Yêu cầu gửi này đã có. Không tạo tin trùng." };
    return { status: "error", message: "Chính sách gửi đã chặn tin này hoặc kênh đang không khả dụng (ví dụ người nhận đã từ chối nhận tin). Tin chưa được gửi." };
  }
  // "@Name" tags picked in a Zalo group go out as real Zalo mentions; anywhere else they stay plain text.
  const rawMentions = formData.get("mentions");
  if (typeof rawMentions === "string" && rawMentions.length > 0 && rawMentions.length <= 10000) {
    let mentions: ReturnType<typeof parseMentions> = null;
    try { mentions = parseMentions(JSON.parse(rawMentions), parsed.data.text); } catch { mentions = null; }
    if (!mentions) return { status: "error", message: "Không đọc được các tag @ trong tin. Hãy gõ lại @ và chọn người cần tag." };
    const privileged = createPrivilegedClient();
    const { data: isGroup } = await privileged.rpc("is_zalo_group_conversation", { p_conversation_id: parsed.data.conversationId });
    if (isGroup === true) {
      const { error: mentionError } = await privileged.from("channel_outbound_actions").update({ mentions })
        .eq("id", actionId).eq("workspace_id", account.workspaceId).eq("status", "PROPOSED").eq("channel_type", "ZALO");
      if (mentionError) return { status: "error", message: "Chưa gắn được tag cho tin này nên tin chưa được gửi. Hãy thử lại." };
    }
  }
  // A Zalo reply may quote one earlier message of this same conversation (received, or sent from HireX).
  const rawQuote = formData.get("quoteMessageId");
  if (typeof rawQuote === "string" && rawQuote.length > 0) {
    if (!/^[1-9][0-9]{0,39}$/u.test(rawQuote)) return { status: "error", message: "Không đọc được tin đang trả lời. Hãy chọn lại tin cần trả lời." };
    const privileged = createPrivilegedClient();
    const [received, sent] = await Promise.all([
      privileged.from("omnichannel_messages").select("id").eq("workspace_id", account.workspaceId).eq("conversation_id", parsed.data.conversationId).eq("provider_message_id", rawQuote).limit(1),
      privileged.from("channel_outbound_actions").select("id").eq("workspace_id", account.workspaceId).eq("conversation_id", parsed.data.conversationId).eq("provider_message_id", rawQuote).eq("status", "SENT").limit(1),
    ]);
    if (!(received.data?.length || sent.data?.length)) return { status: "error", message: "Không tìm thấy tin đang trả lời trong hội thoại này." };
    const { error: quoteError } = await privileged.from("channel_outbound_actions").update({ quote_message_id: rawQuote })
      .eq("id", actionId).eq("workspace_id", account.workspaceId).eq("status", "PROPOSED").eq("channel_type", "ZALO");
    if (quoteError) return { status: "error", message: "Chưa gắn được tin trả lời nên tin chưa được gửi. Hãy thử lại." };
  }
  const { data: approved, error: approvalError } = await supabase.rpc("approve_channel_outbound_action", { p_action_id: actionId });
  if (approvalError || approved !== true) return { status: "error", message: "Tin không qua bước kiểm tra cuối nên chưa được gửi." };
  const { data: action, error: actionError } = await supabase.from("channel_outbound_actions")
    .select("channel_type").eq("id", actionId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (actionError || !action) return { status: "error", message: "Không tìm thấy tin đã duyệt. Đừng gửi lại khi chưa kiểm tra trạng thái." };
  const result = action.channel_type === "FACEBOOK"
    ? await dispatchManualFacebookAction(actionId)
    : action.channel_type === "FACEBOOK_PROFILE" ? await dispatchManualFacebookProfileAction(actionId)
    : action.channel_type === "ZALO" ? await dispatchManualZaloAction(actionId) : "NOT_ELIGIBLE";
  revalidatePath("/inbox/all");
  if (result === "SENT") return { status: "success", message: `Đã gửi một lần qua ${action.channel_type === "ZALO" ? "Zalo" : action.channel_type === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : "Facebook Page"}.` };
  if (result === "DELIVERY_UNKNOWN") return { status: "error", message: "Chưa xác định được kết quả giao tin. Không gửi lại; hãy kiểm tra trạng thái yêu cầu." };
  if (result === "RESPONSE_WINDOW_EXPIRED") return { status: "error", message: "Đã hết thời gian phản hồi Facebook. Tin nhắn chưa được gửi." };
  if (result === "BLOCKED") return { status: "error", message: "Chưa gửi: tài khoản Zalo đang xử lý một yêu cầu trước đó." };
  if (result === "FAILED") return { status: "error", message: "Nhà cung cấp đã từ chối tin nhắn trước khi xác nhận giao thành công." };
  return { status: "error", message: "Kênh gửi hiện không khả dụng. Yêu cầu được giữ lại để kiểm tra và không được gửi lại." };
}

/**
 * Sends one file the member just uploaded (upload route) into a Zalo chat, as its own message. Same checks as a
 * text reply (reply permission, access to the nick, one pending message at a time, one send per request id);
 * the reply is proposed as "this file only" (migration 094), approved and sent once.
 */
export async function sendZaloFileReply(input: { conversationId: string; attachmentId: string; idempotencyKey: string }): Promise<ChannelActionState> {
  const parsed = z.object({ conversationId: uuid, attachmentId: uuid, idempotencyKey: uuid }).safeParse(input);
  const account = await getAccountContext();
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase || !account?.workspaceId) return { status: "error", message: "Không thể gửi tệp." };
  if (!await hasPermission("inbox.reply")) return { status: "error", message: "Tài khoản của bạn không có quyền trả lời hội thoại." };
  const privileged = createPrivilegedClient();
  const { data: conversation } = await privileged.from("omnichannel_conversations").select("channel_account_id,channel_type")
    .eq("id", parsed.data.conversationId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!conversation || !await canAccessChannelAccount(conversation.channel_account_id)) return { status: "error", message: "Bạn chưa được cấp quyền sử dụng tài khoản kết nối của hội thoại này." };
  if (conversation.channel_type !== "ZALO") return { status: "error", message: "Hiện chỉ gửi được tệp qua Zalo." };
  const { data: file } = await privileged.from("channel_attachments").select("filename")
    .eq("id", parsed.data.attachmentId).eq("workspace_id", account.workspaceId).eq("source", "HUMAN_UPLOAD").eq("created_by", account.userId).maybeSingle();
  if (typeof file?.filename !== "string") return { status: "error", message: "Không tìm thấy tệp vừa tải lên. Hãy chọn lại tệp." };
  const { data: existingPending, error: pendingError } = await supabase.from("channel_outbound_actions").select("id")
    .eq("workspace_id", account.workspaceId).eq("conversation_id", parsed.data.conversationId).eq("status", "APPROVED").eq("attempt_count", 0).limit(1);
  if (pendingError) return { status: "error", message: "Không thể kiểm tra tin đang chờ. Hệ thống không tạo yêu cầu mới." };
  if ((existingPending ?? []).length > 0) return { status: "error", message: "Một tin trước đó vẫn đang chờ. Hãy xử lý tin đó trước." };
  const { data: existingRequest, error: existingRequestError } = await supabase.from("channel_outbound_actions").select("id,status")
    .eq("workspace_id", account.workspaceId).eq("conversation_id", parsed.data.conversationId).eq("idempotency_key", parsed.data.idempotencyKey).maybeSingle();
  if (existingRequestError) return { status: "error", message: "Không kiểm tra được yêu cầu gửi. Hệ thống không tạo yêu cầu mới." };
  if (existingRequest) return existingRequest.status === "SENT" ? { status: "success", message: "Tệp này đã được gửi." } : { status: "error", message: "Yêu cầu gửi tệp này đã tồn tại; không tạo bản trùng." };
  // Proposed directly as "this one file, no text" (migration 094), then approved and sent like a text reply.
  const { data: actionId, error: proposalError } = await supabase.rpc("propose_zalo_file_reply", {
    p_conversation_id: parsed.data.conversationId, p_attachment_id: parsed.data.attachmentId, p_idempotency_key: parsed.data.idempotencyKey });
  if (proposalError || typeof actionId !== "string")
    return { status: "error", message: "Chưa tạo được tin gửi tệp (tệp có thể đang được gửi ở một tin khác, hoặc kênh đang bị chặn). Tệp chưa được gửi." };
  const { data: approved, error: approvalError } = await supabase.rpc("approve_channel_outbound_action", { p_action_id: actionId });
  if (approvalError || approved !== true) return { status: "error", message: "Tin không qua được bước kiểm tra cuối nên chưa được gửi." };
  const result = await dispatchManualZaloAction(actionId);
  revalidatePath("/inbox/all");
  if (result === "SENT") return { status: "success", message: "Đã gửi tệp qua Zalo." };
  if (result === "DELIVERY_UNKNOWN") return { status: "error", message: "Chưa xác định được kết quả gửi tệp. Không gửi lại; hệ thống sẽ tự đối chiếu với Zalo." };
  if (result === "BLOCKED") return { status: "error", message: "Chưa gửi: tài khoản Zalo đang xử lý một yêu cầu trước đó." };
  if (result === "FAILED") return { status: "error", message: "Zalo đã từ chối tệp nên tệp chưa được gửi." };
  return { status: "error", message: "Kênh gửi hiện không khả dụng. Tệp chưa được gửi lại." };
}

export async function dispatchPendingManualChannelMessage(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("actionId"));
  const account = await getAccountContext();
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase || !account?.workspaceId) return { status: "error", message: "Không tìm thấy tin đang chờ gửi." };
  if (!await hasPermission("inbox.reply")) return { status: "error", message: "Bạn không có quyền trả lời hội thoại." };
  const { data: action, error } = await supabase.from("channel_outbound_actions").select("channel_type,status,attempt_count,conversation_id")
    .eq("id", parsed.data).eq("workspace_id", account.workspaceId).maybeSingle();
  if (error || !action || action.status !== "APPROVED" || action.attempt_count !== 0 || action.channel_type !== "ZALO")
    return { status: "error", message: "Tin đang chờ này không còn hợp lệ. Hãy tải lại Suối Nguồn." };
  const result = await dispatchManualZaloAction(parsed.data, { reauthorizeExpiredHumanPolicy: true });
  revalidatePath("/inbox/all");
  if (result === "SENT") return { status: "success", message: "Đã gửi tin Zalo." };
  if (result === "DELIVERY_UNKNOWN") return { status: "error", message: "Chưa rõ tin đã tới chưa. Đừng gửi lại." };
  if (result === "BLOCKED") return { status: "error", message: "Nick Zalo đang bận. Tin này chưa được gửi lại." };
  if (result === "FAILED") return { status: "error", message: "Zalo từ chối tin này trước khi gửi được." };
  return { status: "error", message: "Tin đang chờ gửi vẫn chưa sẵn sàng. Chưa tạo lệnh gửi mới." };
}

/**
 * Cancels a manual message that is still waiting and was never attempted (APPROVED, 0 attempts), e.g.
 * one stuck because its conversation is a Zalo group. Nothing was sent, so nothing can be duplicated.
 */
export async function cancelPendingManualChannelMessage(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("actionId"));
  const account = await getAccountContext();
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase || !account?.workspaceId) return { status: "error", message: "Không huỷ được tin đang chờ." };
  if (!await hasPermission("inbox.reply")) return { status: "error", message: "Bạn không có quyền trả lời hội thoại." };
  // Read with the member's own session: only actions on accounts they can see.
  const { data: action } = await supabase.from("channel_outbound_actions").select("id,status,attempt_count,channel_account_id")
    .eq("id", parsed.data).eq("workspace_id", account.workspaceId).maybeSingle();
  if (!action || action.status !== "APPROVED" || action.attempt_count !== 0 || !await canAccessChannelAccount(action.channel_account_id))
    return { status: "error", message: "Tin này không còn ở trạng thái chờ. Tải lại trang." };
  const { data: cancelled, error } = await createPrivilegedClient().from("channel_outbound_actions").update({ status: "CANCELLED" })
    .eq("id", action.id).eq("workspace_id", account.workspaceId).eq("status", "APPROVED").eq("attempt_count", 0).select("id");
  revalidatePath("/inbox/all");
  if (error || !cancelled?.length) return { status: "error", message: "Không huỷ được tin đang chờ, thử lại sau." };
  return { status: "success", message: "Đã huỷ tin đang chờ. Tin chưa được gửi." };
}

export async function acknowledgeZaloDeliveryUnknown(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("actionId"));
  if (!parsed.success) return { status: "error", message: "Chưa ghi nhận được tin chưa rõ trạng thái." };
  if (!await hasPermission("inbox.reply")) return { status: "error", message: "Bạn không có quyền trả lời hội thoại." };
  const supabase = await authenticatedClient();
  if (!supabase) return { status: "error", message: "Chưa ghi nhận được tin chưa rõ trạng thái." };
  const { data: action, error: lookupError } = await supabase.from("channel_outbound_actions")
    .select("id").eq("id", parsed.data).maybeSingle();
  if (lookupError || !action) return { status: "error", message: "Bạn không có quyền truy cập yêu cầu gửi này." };
  const result = await reconcileZaloDeliveryUnknown(parsed.data);
  revalidatePath("/inbox/all");
  return result === "ACKNOWLEDGED_NO_RETRY"
    ? { status: "success", message: "Chưa ghi nhận lần gửi lại. Tin ban đầu vẫn chưa rõ đã tới chưa." }
    : { status: "error", message: "Chưa ghi nhận được tin chưa rõ trạng thái." };
}

export async function approveChannelMessage(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = uuid.safeParse(formData.get("actionId"));
  const account = await getAccountContext();
  const supabase = await authenticatedClient();
  if (!parsed.success || !supabase || !account?.workspaceId) return { status: "error", message: "Chưa duyệt được tin." };
  if (!await hasPermission("inbox.reply")) return { status: "error", message: "Bạn không có quyền trả lời hội thoại." };
  const { data: action, error: actionError } = await supabase.from("channel_outbound_actions")
    .select("id,channel_type,status,attempt_count,proposed_by,dispatch_source,idempotency_key,conversation_id")
    .eq("id", parsed.data).eq("workspace_id", account.workspaceId).maybeSingle();
  if (actionError || !action || action.status !== "PROPOSED") return { status: "error", message: "Bản nháp này không còn chờ duyệt. Hãy tải lại Suối Nguồn." };
  const isAiRecruiterDraft=action.proposed_by === "AI_ASSIST" && action.dispatch_source === "AI_AUTOMATION" && action.idempotency_key?.startsWith("ai-recruiter-draft:");
  if(isAiRecruiterDraft){
    const refreshed = await supabase.rpc("refresh_ai_recruiter_draft_policy", { p_action_id: parsed.data });
    if(refreshed.error||refreshed.data!==true)return{status:"error",message:"Bản nháp của AI Recruiter không qua bước kiểm tra chính sách."};
  }
  const approval = await supabase.rpc("approve_channel_outbound_action", { p_action_id: parsed.data });
  if (approval.error || approval.data !== true) return { status: "error", message: "Tin không qua bước kiểm tra chính sách khi duyệt." };
  if (action.channel_type === "FACEBOOK") {
    const result = await dispatchManualFacebookAction(parsed.data);
    revalidatePath("/inbox/all");
    if (result === "SENT") return { status: "success", message: "Đã gửi tin Facebook." };
    if (result === "DELIVERY_UNKNOWN") return { status: "error", message: "Chưa rõ tin đã tới chưa. Đừng duyệt hay gửi lại; hãy kiểm tra trạng thái tin trước." };
    if (result === "RESPONSE_WINDOW_EXPIRED") return { status: "error", message: "Đã quá thời hạn trả lời của Facebook. Tin chưa được gửi." };
    if (result === "FAILED") return { status: "error", message: "Facebook từ chối tin này. Xem lỗi của tin trước khi soạn bản mới." };
    return { status: "error", message: "Đã duyệt bản nháp nhưng chưa xác nhận đã gửi. Tải lại và kiểm tra trạng thái trước khi thử lại." };
  }
  if (action.channel_type === "ZALO") {
    const result = await dispatchManualZaloAction(parsed.data);
    revalidatePath("/inbox/all");
    if (result === "SENT") return { status: "success", message: "Zalo đã nhận tin." };
    if (result === "DELIVERY_UNKNOWN") return { status: "error", message: "Chưa rõ tin đã tới chưa. Đừng duyệt hay gửi lại; hãy kiểm tra trạng thái tin trước." };
    if (result === "BLOCKED") return { status: "error", message: "Chưa gửi: nick Zalo đang bận với yêu cầu trước. Đừng gửi lại tin này." };
    if (result === "FAILED") return { status: "error", message: "Zalo từ chối tin này. Xem lỗi của tin trước khi soạn bản mới." };
    return { status: "error", message: "Gửi thử Zalo đang không khả dụng. Đừng thử gửi thêm." };
  }
  revalidatePath("/inbox/all");
  return { status: "success", message: "Đã duyệt tin, đang chờ gửi qua kênh." };
}

export async function reviewAutomationProposal(_state:ChannelActionState,formData:FormData):Promise<ChannelActionState>{
  const parsed=z.object({proposalId:uuid,approved:z.enum(["true","false"])}).safeParse(Object.fromEntries(formData));const supabase=await authenticatedClient();if(!parsed.success||!supabase)return{status:"error",message:"Chưa duyệt được đề xuất tự động hóa."};if(!await hasPermission("channels.manage"))return{status:"error",message:"Bạn không có quyền quản lý kênh kết nối."};const{data,error}=await supabase.rpc("review_channel_automation_proposal",{p_proposal_id:parsed.data.proposalId,p_approved:parsed.data.approved==="true"});if(error||data!==true)return{status:"error",message:"Đề xuất tự động hóa không qua bước kiểm tra an toàn."};revalidatePath("/settings/channels/automations");revalidatePath("/inbox/all");revalidatePath("/tasks");return{status:"success",message:parsed.data.approved==="true"?"Automation proposal applied.":"Automation proposal rejected."}
}
