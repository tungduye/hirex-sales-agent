import "server-only";

import { randomInt } from "node:crypto";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { runAsMember } from "@/lib/supabase/acting-session";
import { isGroupConversation, isZaloGroupThread } from "@/modules/assistant/core/assistant-tools";
import { isBotCall, parseLinkCode, splitZaloParts, stripBotCall, toZaloText } from "@/modules/assistant/core/zalo-bot-text";
import { runAssistantRequest } from "@/modules/assistant/server/run-assistant-request";
import { ChannelAdapterRegistry } from "@/modules/channels/core/channel-adapter-registry";
import { executeChannelOutboundAction } from "@/modules/channels/server/execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";

type Db = ReturnType<typeof createPrivilegedClient>;
interface BotSettings { channelAccountId: string; name: string; enabledAt: string }

const settingsCache = new Map<string, { value: BotSettings | null; at: number }>();
/** The workspace's Zalo Trợ lý nick, if one is switched on (cached 30 s; changes clear it). */
export async function botSettings(db: Db, workspaceId: string): Promise<BotSettings | null> {
  const cached = settingsCache.get(workspaceId);
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  const { data } = await db.from("assistant_bot_settings").select("channel_account_id,enabled,enabled_at,channel_accounts(display_name)").eq("workspace_id", workspaceId).maybeSingle();
  const account = data?.channel_accounts as unknown as { display_name: string | null } | null;
  const value = data?.enabled && data.channel_account_id ? { channelAccountId: data.channel_account_id as string, name: account?.display_name?.trim() || "Trợ lý", enabledAt: (data.enabled_at as string) ?? new Date(0).toISOString() } : null;
  settingsCache.set(workspaceId, { value, at: Date.now() });
  return value;
}
export function forgetBotSettings(workspaceId: string) { settingsCache.delete(workspaceId); }

/** Called for every inbound channel message: queues those meant for the Trợ lý nick. Never throws. */
export async function enqueueAssistantBotInbound(input: { workspaceId: string; channelAccountId: string; conversationId: string; messageId: string; text: string | null; senderExternalId: string; providerConversationId: string; conversationMetadata: unknown }) {
  try {
    if (!input.text?.trim()) return;
    const db = createPrivilegedClient();
    const settings = await botSettings(db, input.workspaceId);
    if (!settings || settings.channelAccountId !== input.channelAccountId) return;
    const group = isGroupConversation(input.conversationMetadata) || isZaloGroupThread("ZALO", input.providerConversationId, input.senderExternalId);
    // In a group, only messages that call the Trợ lý; in a private chat, everything (unlinked senders are ignored later).
    if (group && !isBotCall(input.text, settings.name)) return;
    await db.from("assistant_bot_jobs").upsert({ workspace_id: input.workspaceId, channel_account_id: input.channelAccountId, conversation_id: input.conversationId, message_id: input.messageId }, { onConflict: "message_id", ignoreDuplicates: true });
  } catch { /* The Trợ lý queue must never fail channel ingestion. */ }
}

async function sendReply(db: Db, workspaceId: string, jobId: string, channelAccountId: string, text: string) {
  const parts = splitZaloParts(text);
  const loaded = await loadChannelAdapterByAccountId(channelAccountId);
  const registry = new ChannelAdapterRegistry();
  registry.register(loaded.adapter);
  for (const [index, part] of parts.entries()) {
    const { data: actionId, error } = await db.rpc("propose_assistant_bot_message_service", { p_workspace_id: workspaceId, p_job_id: jobId, p_text_content: part, p_part: index + 1 });
    if (error || typeof actionId !== "string") return false;
    const result = await executeChannelOutboundAction(actionId, registry);
    if (result.status !== "SENT") return false;
  }
  return true;
}

async function finish(db: Db, jobId: string, status: "DONE" | "SKIPPED" | "FAILED", extra: Record<string, unknown> = {}) {
  await db.from("assistant_bot_jobs").update({ status, completed_at: new Date().toISOString(), ...extra }).eq("id", jobId);
}

/** Handles one queued message: link codes, then questions from linked members (answered as that member). */
export async function processNextAssistantBotJob(): Promise<{ processed: boolean; status?: string }> {
  const db = createPrivilegedClient();
  const { data: claimed, error } = await db.rpc("claim_assistant_bot_job");
  const job = Array.isArray(claimed) ? claimed[0] : null;
  if (error || !job) return { processed: false };
  const jobId = job.id as string, workspaceId = job.workspace_id as string;
  try {
    const settings = await botSettings(db, workspaceId);
    if (!settings || settings.channelAccountId !== job.channel_account_id) { await finish(db, jobId, "SKIPPED", { safe_error_code: "BOT_DISABLED" }); return { processed: true, status: "SKIPPED" }; }
    const [{ data: message }, { data: conversation }] = await Promise.all([
      db.from("omnichannel_messages").select("text_content,sender_external_id,direction,created_at").eq("id", job.message_id).maybeSingle(),
      db.from("omnichannel_conversations").select("id,provider_conversation_id,metadata").eq("id", job.conversation_id).maybeSingle(),
    ]);
    const text = typeof message?.text_content === "string" ? message.text_content.trim() : "";
    if (!message || !conversation || message.direction !== "INBOUND" || !text || Date.parse(message.created_at as string) < Date.parse(settings.enabledAt)) { await finish(db, jobId, "SKIPPED", { safe_error_code: "NOT_A_QUESTION" }); return { processed: true, status: "SKIPPED" }; }
    const sender = String(message.sender_external_id);
    const group = isGroupConversation(conversation.metadata) || isZaloGroupThread("ZALO", conversation.provider_conversation_id as string, sender);

    // Linking: a member sends the 6-digit code from the Trợ lý page in a private chat.
    const code = group ? null : parseLinkCode(text);
    if (code) {
      const { data: open } = await db.from("assistant_link_codes").select("id,profile_id,expires_at").eq("workspace_id", workspaceId).eq("code", code).is("used_at", null).maybeSingle();
      if (!open || Date.parse(open.expires_at as string) < Date.now()) {
        const sent = await sendReply(db, workspaceId, jobId, settings.channelAccountId, "Dạ, mã liên kết không đúng hoặc đã hết hạn (10 phút). Sếp lấy mã mới ở trang Trợ lý trên HireX rồi gửi lại cho em ạ.");
        await finish(db, jobId, sent ? "DONE" : "FAILED", sent ? {} : { safe_error_code: "SEND_FAILED" });
        return { processed: true, status: "LINK_INVALID" };
      }
      const name = typeof (conversation.metadata as Record<string, unknown> | null)?.participantDisplayName === "string" ? String((conversation.metadata as Record<string, unknown>).participantDisplayName).slice(0, 200) : null;
      await db.from("assistant_link_codes").update({ used_at: new Date().toISOString() }).eq("id", open.id);
      await db.from("assistant_zalo_links").delete().eq("workspace_id", workspaceId).eq("zalo_user_id", sender);
      await db.from("assistant_zalo_links").insert({ workspace_id: workspaceId, profile_id: open.profile_id, zalo_user_id: sender, zalo_name: name });
      const { data: profile } = await db.from("profiles").select("full_name").eq("id", open.profile_id).maybeSingle();
      const sent = await sendReply(db, workspaceId, jobId, settings.channelAccountId, `Dạ, em đã liên kết Zalo này với tài khoản HireX của ${profile?.full_name ?? "sếp"}. Từ giờ sếp cứ nhắn câu hỏi cho em như trên trang Trợ lý ạ. Trong nhóm, sếp gọi em bằng @${settings.name} hoặc bắt đầu tin bằng /tl.`);
      await finish(db, jobId, sent ? "DONE" : "FAILED", { profile_id: open.profile_id, ...(sent ? {} : { safe_error_code: "SEND_FAILED" }) });
      return { processed: true, status: "LINKED" };
    }

    // Only linked members get answers; anyone else (candidates included) gets no reply at all.
    const { data: link } = await db.from("assistant_zalo_links").select("profile_id").eq("workspace_id", workspaceId).eq("zalo_user_id", sender).maybeSingle();
    if (!link) { await finish(db, jobId, "SKIPPED", { safe_error_code: "NOT_LINKED" }); return { processed: true, status: "SKIPPED" }; }
    const profileId = link.profile_id as string;
    const question = (group ? stripBotCall(text, settings.name) : text).slice(0, 1000);
    if (!question) {
      const sent = await sendReply(db, workspaceId, jobId, settings.channelAccountId, "Dạ, sếp cần em tra cứu gì ạ?");
      await finish(db, jobId, sent ? "DONE" : "FAILED", { profile_id: profileId });
      return { processed: true, status: "DONE" };
    }

    // One saved conversation per member and Zalo chat, continued while it is less than 12 hours old.
    const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
    const { data: thread } = await db.from("assistant_conversations").select("id").eq("workspace_id", workspaceId).eq("user_id", profileId).eq("source_conversation_id", conversation.id).gte("updated_at", since).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    const conversationId = (thread?.id as string | undefined) ?? null;
    const { data: past } = conversationId ? await db.from("assistant_messages").select("role,content,is_error").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20) : { data: [] as Array<{ role: string; content: string; is_error: boolean }> };
    const history = (past ?? []).filter((row) => !row.is_error).reverse().map((row) => ({ role: row.role as "user" | "assistant", content: String(row.content).slice(0, 8000) }));

    const result = await runAsMember(profileId, () => runAssistantRequest({ question, history, pagePath: null, allowDocuments: true, uploadId: null, save: true, conversationId, source: { channel: "ZALO", sourceConversationId: conversation.id as string } }));
    const base = process.env.APP_BASE_URL?.trim() || "https://app.hirexmkt.online";
    let reply = result.ok ? toZaloText(result.answer, base) : result.message;
    if (result.ok && result.pendingActions.length && result.conversationId) reply += `\n\nDạ, em đã chuẩn bị ${result.pendingActions.length} thao tác, sếp mở link để xem và bấm Xác nhận ạ: ${base}/assistant/c/${result.conversationId}`;
    const sent = await sendReply(db, workspaceId, jobId, settings.channelAccountId, reply);
    await finish(db, jobId, sent ? "DONE" : "FAILED", { profile_id: profileId, ...(sent ? {} : { safe_error_code: "SEND_FAILED" }) });
    return { processed: true, status: sent ? "DONE" : "FAILED" };
  } catch (caught) {
    const code = caught instanceof Error && /^[A-Z_]{3,60}$/u.test(caught.message) ? caught.message : "BOT_FAILED";
    await finish(db, jobId, "FAILED", { safe_error_code: code });
    return { processed: true, status: "FAILED" };
  }
}

/** A fresh 6-digit code for the member to send to the Trợ lý nick (10 minutes, one at a time). */
export async function createLinkCode(db: Db, workspaceId: string, profileId: string) {
  await db.from("assistant_link_codes").update({ used_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("profile_id", profileId).is("used_at", null);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { error } = await db.from("assistant_link_codes").insert({ workspace_id: workspaceId, profile_id: profileId, code, expires_at: expiresAt });
    if (!error) return { code, expiresAt };
  }
  return null;
}
