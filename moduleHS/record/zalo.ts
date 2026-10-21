import "server-only";

// Thông báo Zalo của Cuộc họp: dùng luôn nick Zalo đã kết nối trong HireX (không đăng nhập QR riêng như bản gốc).
// Tin được đưa vào hàng gửi chuẩn của HireX (channel_outbound_actions, như Gửi nhóm Zalo) và gửi ngay qua cầu Zalo.
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { ChannelAdapterRegistry } from "@/modules/channels/core/channel-adapter-registry";
import { executeChannelOutboundAction } from "@/modules/channels/server/execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";
import { broadcastGroups, broadcastNicks, type BroadcastContext } from "@/modules/broadcasts/server/broadcast-data";
import { settings } from "./data";

const ERRORS: Record<string, string> = { ACCOUNT_UNAVAILABLE: "Nick Zalo đang mất kết nối", ACCOUNT_BUSY: "Nick Zalo đang bận", DELIVERY_UNKNOWN: "Chưa rõ đã gửi được chưa", NOT_ELIGIBLE: "Tin không đủ điều kiện gửi", UNAVAILABLE: "Hệ thống gửi Zalo đang bận", DEFERRED: "Tin đang chờ gửi" };

/** Gửi một tin vào nhóm đã chọn. key: để nhận ra tin (mỗi lần gửi một khoá mới). */
export async function zaloSend(text: string, key: string) {
  const s = settings();
  if (!s.workspace_id || !s.account_id || !s.conversation_id || !s.by) throw new Error("Chưa chọn nơi nhận Zalo");
  const db = createPrivilegedClient();
  const { data: conv } = await db.from("omnichannel_conversations").select("id,channel_account_id,provider_conversation_id")
    .eq("id", s.conversation_id).eq("workspace_id", s.workspace_id).eq("channel_account_id", s.account_id).eq("channel_type", "ZALO").maybeSingle();
  if (!conv?.provider_conversation_id) throw new Error("Không còn thấy nhóm Zalo đã chọn");
  const now = new Date();
  const { data: policy, error: policyError } = await db.from("channel_policy_decisions").insert({
    workspace_id: s.workspace_id, conversation_id: conv.id, channel_account_id: s.account_id, channel_type: "ZALO",
    normalized_recipient: String(conv.provider_conversation_id).trim().toLowerCase(), allowed: true, reason_codes: ["GROUP_BROADCAST"], expires_at: new Date(now.getTime() + 10 * 60000).toISOString(),
  }).select("id").single();
  if (policyError || !policy) throw new Error("Không tạo được lệnh gửi Zalo");
  const { data: action, error: actionError } = await db.from("channel_outbound_actions").insert({
    workspace_id: s.workspace_id, conversation_id: conv.id, channel_account_id: s.account_id, channel_type: "ZALO", recipient_external_id: conv.provider_conversation_id,
    status: "APPROVED", text_content: text.slice(0, 4000), attachment_ids: [], approved_by: s.by, approved_at: now.toISOString(),
    idempotency_key: `hs-record:${key}:${now.getTime()}`, policy_decision_id: policy.id, proposed_by: "HUMAN", dispatch_source: "AI_AUTOMATION",
  }).select("id").single();
  if (actionError || !action) throw new Error("Không tạo được lệnh gửi Zalo");
  const registry = new ChannelAdapterRegistry();
  registry.register((await loadChannelAdapterByAccountId(s.account_id)).adapter);
  const result = await executeChannelOutboundAction(String(action.id), registry);
  if (result.status !== "SENT") throw new Error(ERRORS["safeErrorCode" in result ? result.safeErrorCode : result.status] || ("safeErrorCode" in result ? result.safeErrorCode : result.status));
}

/** Nick Zalo người dùng được dùng, và các nhóm của nick đã chọn (để chọn nơi nhận trong Cài đặt). */
export async function zaloTargets(context: BroadcastContext, accountId: string) {
  const nicks = await broadcastNicks(context);
  const groups = accountId ? (await broadcastGroups(context, [accountId])).map((g) => ({ id: g.accounts.find((a) => a.accountId === accountId)?.conversationId || "", name: g.name })).filter((g) => g.id) : [];
  groups.sort((a, b) => a.name.localeCompare(b.name, "vi"));
  return { nicks: nicks.map((n) => ({ id: n.id, name: n.name, connected: n.status === "CONNECTED" })), groups };
}
