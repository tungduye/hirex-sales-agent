import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { ChannelAdapterRegistry } from "../core/channel-adapter-registry";
import { executeChannelOutboundAction } from "./execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "./load-channel-adapter";

const QA_TEXT = "HireX outbound QA 01";
export type ManualZaloDispatchResult = "SENT" | "FAILED" | "BLOCKED" | "DELIVERY_UNKNOWN" | "NOT_ELIGIBLE" | "UNAVAILABLE";

export async function dispatchManualZaloAction(actionId: string, options?: { reauthorizeExpiredHumanPolicy?: boolean }): Promise<ManualZaloDispatchResult> {
  const account = await getAccountContext();
  if (!account?.configurationComplete || !account.workspaceId) return "UNAVAILABLE";
  const sessionClient = await createClient();
  const { data: action, error } = await sessionClient.from("channel_outbound_actions")
    .select("id,workspace_id,channel_account_id,conversation_id,channel_type,recipient_external_id,text_content,status,attempt_count,policy_decision_id")
    .eq("id", actionId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (error || !action) return "UNAVAILABLE";
  if (action.channel_type !== "ZALO" || action.status !== "APPROVED" || action.attempt_count !== 0 ||
      typeof action.channel_account_id !== "string" || typeof action.conversation_id !== "string" ||
      typeof action.recipient_external_id !== "string") return "NOT_ELIGIBLE";
  return dispatchApprovedZaloAction(actionId, account.workspaceId, options?.reauthorizeExpiredHumanPolicy === true);
}

async function dispatchApprovedZaloAction(actionId: string, expectedWorkspaceId: string, reauthorizeExpiredHumanPolicy: boolean): Promise<ManualZaloDispatchResult> {
  const privilegedClient = createPrivilegedClient();
  const { data: action, error } = await privilegedClient.from("channel_outbound_actions")
    .select("id,workspace_id,channel_account_id,conversation_id,channel_type,recipient_external_id,status,attempt_count,policy_decision_id,dispatch_source")
    .eq("id", actionId).eq("workspace_id", expectedWorkspaceId).maybeSingle();
  if (error || !action) return "UNAVAILABLE";
  if (action.channel_type !== "ZALO" || action.status !== "APPROVED" || action.attempt_count !== 0 ||
      typeof action.channel_account_id !== "string" || typeof action.conversation_id !== "string" ||
      typeof action.recipient_external_id !== "string" || typeof action.policy_decision_id !== "string") return "NOT_ELIGIBLE";
  const [{ data: channelAccount, error: channelError }, { data: conversation, error: conversationError }, { data: policy, error: policyError }] = await Promise.all([
    privilegedClient.from("channel_accounts").select("id,status,operator_enabled,capabilities")
      .eq("id", action.channel_account_id).eq("workspace_id", action.workspace_id).eq("channel_type", "ZALO").eq("provider", "ZALO_BRIDGE").maybeSingle(),
    privilegedClient.from("omnichannel_conversations").select("id,channel_account_id,channel_type,provider_conversation_id,status")
      .eq("id", action.conversation_id).eq("workspace_id", action.workspace_id).eq("channel_account_id", action.channel_account_id).maybeSingle(),
    privilegedClient.from("channel_policy_decisions").select("id,channel_account_id,channel_type,normalized_recipient,allowed,expires_at")
      .eq("id", action.policy_decision_id).eq("workspace_id", action.workspace_id).maybeSingle(),
  ]);
  if (channelError || conversationError || policyError || !channelAccount || !conversation || !policy) return "UNAVAILABLE";
  if (channelAccount.status !== "CONNECTED" || channelAccount.operator_enabled !== true || !Array.isArray(channelAccount.capabilities) ||
      !channelAccount.capabilities.includes("SEND_TEXT") || conversation.channel_type !== "ZALO" || !["OPEN", "PENDING"].includes(conversation.status) ||
      conversation.provider_conversation_id !== action.recipient_external_id || policy.channel_account_id !== action.channel_account_id ||
      policy.channel_type !== "ZALO" || policy.normalized_recipient !== action.recipient_external_id.trim().toLowerCase() || policy.allowed !== true ||
      typeof policy.expires_at !== "string" || !Number.isFinite(Date.parse(policy.expires_at))) return "NOT_ELIGIBLE";
  if (Date.parse(policy.expires_at) <= Date.now()) {
    if (!reauthorizeExpiredHumanPolicy || action.dispatch_source !== "HUMAN_MANUAL") return "NOT_ELIGIBLE";
    const { count, error: suppressionError } = await privilegedClient.from("channel_suppressions")
      .select("id", { count: "exact", head: true }).eq("workspace_id", action.workspace_id).eq("channel_type", "ZALO")
      .eq("normalized_recipient", action.recipient_external_id.trim().toLowerCase());
    if (suppressionError) return "UNAVAILABLE";
    if ((count ?? 0) > 0) return "NOT_ELIGIBLE";
    const { data: freshPolicy, error: insertError } = await privilegedClient.from("channel_policy_decisions").insert({
      workspace_id: action.workspace_id, conversation_id: action.conversation_id, channel_account_id: action.channel_account_id,
      channel_type: "ZALO", normalized_recipient: action.recipient_external_id.trim().toLowerCase(), allowed: true,
      reason_codes: ["HUMAN_MANUAL_REAUTHORIZED"], expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    }).select("id").single();
    if (insertError || typeof freshPolicy?.id !== "string") return "UNAVAILABLE";
    const { data: rebound, error: reboundError } = await privilegedClient.from("channel_outbound_actions")
      .update({ policy_decision_id: freshPolicy.id }).eq("id", action.id).eq("workspace_id", action.workspace_id)
      .eq("status", "APPROVED").eq("attempt_count", 0).eq("policy_decision_id", policy.id).select("id").maybeSingle();
    if (reboundError || !rebound) {
      await privilegedClient.from("channel_policy_decisions").delete().eq("id", freshPolicy.id).eq("workspace_id", action.workspace_id);
      return "NOT_ELIGIBLE";
    }
  }
  try {
    const loaded = await loadChannelAdapterByAccountId(action.channel_account_id);
    if (loaded.channelAccountId !== action.channel_account_id || loaded.adapter.channelType !== "ZALO") return "UNAVAILABLE";
    const registry = new ChannelAdapterRegistry();
    registry.register(loaded.adapter);
    const execution = await executeChannelOutboundAction(actionId, registry);
    return execution.status === "DEFERRED" ? "UNAVAILABLE" : execution.status === "FAILED" && execution.safeErrorCode === "ACCOUNT_BUSY" ? "BLOCKED" : execution.status;
  } catch { return "UNAVAILABLE"; }
}

export async function dispatchApprovedZaloQaAction(actionId: string, expectedWorkspaceId?: string): Promise<ManualZaloDispatchResult> {
  if (process.env.HIREX_ZALO_REAL_OUTBOUND_QA_ENABLED !== "1") return "NOT_ELIGIBLE";
  const qaProviderAccountId = process.env.HIREX_ZALO_QA_ACCOUNT_ID;
  if (!qaProviderAccountId) return "UNAVAILABLE";
  const privilegedClient = createPrivilegedClient();
  const { data: action, error } = await privilegedClient.from("channel_outbound_actions")
    .select("id,workspace_id,channel_account_id,conversation_id,channel_type,recipient_external_id,text_content,status,attempt_count,policy_decision_id")
    .eq("id", actionId).maybeSingle();
  if (error || !action || (expectedWorkspaceId && action.workspace_id !== expectedWorkspaceId)) return "UNAVAILABLE";
  if (action.channel_type !== "ZALO" || action.status !== "APPROVED" || action.attempt_count !== 0 || action.text_content !== QA_TEXT ||
      typeof action.workspace_id !== "string" || typeof action.channel_account_id !== "string" || typeof action.conversation_id !== "string" ||
      typeof action.recipient_external_id !== "string" || typeof action.policy_decision_id !== "string") return "NOT_ELIGIBLE";
  const [{ data: channelAccount, error: channelError }, { data: conversation, error: conversationError }] = await Promise.all([
    privilegedClient.from("channel_accounts").select("id,external_account_id,status,operator_enabled,capabilities")
      .eq("id", action.channel_account_id).eq("workspace_id", action.workspace_id).eq("channel_type", "ZALO").eq("provider", "ZALO_BRIDGE").maybeSingle(),
    privilegedClient.from("omnichannel_conversations").select("id,channel_account_id,channel_type,provider_conversation_id,status")
      .eq("id", action.conversation_id).eq("workspace_id", action.workspace_id).eq("channel_account_id", action.channel_account_id).maybeSingle(),
  ]);
  if (channelError || conversationError || !channelAccount || !conversation) return "UNAVAILABLE";
  if (channelAccount.external_account_id !== qaProviderAccountId || channelAccount.status !== "CONNECTED" || channelAccount.operator_enabled !== true ||
      !Array.isArray(channelAccount.capabilities) || !channelAccount.capabilities.includes("SEND_TEXT") ||
      conversation.channel_type !== "ZALO" || !["OPEN", "PENDING"].includes(conversation.status) ||
      conversation.provider_conversation_id !== action.recipient_external_id) return "NOT_ELIGIBLE";
  const { data: policy, error: policyError } = await privilegedClient.from("channel_policy_decisions")
    .select("id,workspace_id,channel_account_id,channel_type,normalized_recipient,allowed,expires_at")
    .eq("id", action.policy_decision_id).eq("workspace_id", action.workspace_id).maybeSingle();
  if (policyError || !policy || policy.channel_account_id !== action.channel_account_id || policy.channel_type !== "ZALO" ||
      policy.normalized_recipient !== action.recipient_external_id.trim().toLowerCase() || policy.allowed !== true ||
      typeof policy.expires_at !== "string") return "NOT_ELIGIBLE";
  if (!Number.isFinite(Date.parse(policy.expires_at)) || Date.parse(policy.expires_at) <= Date.now()) {
    const { count, error: suppressionError } = await privilegedClient.from("channel_suppressions")
      .select("id", { count: "exact", head: true }).eq("workspace_id", action.workspace_id).eq("channel_type", "ZALO")
      .eq("normalized_recipient", action.recipient_external_id.trim().toLowerCase());
    if (suppressionError) return "UNAVAILABLE";
    if ((count ?? 0) > 0) return "NOT_ELIGIBLE";
    const { data: freshPolicy, error: insertError } = await privilegedClient.from("channel_policy_decisions").insert({
      workspace_id: action.workspace_id, conversation_id: action.conversation_id, channel_account_id: action.channel_account_id,
      channel_type: "ZALO", normalized_recipient: action.recipient_external_id.trim().toLowerCase(), allowed: true,
      reason_codes: ["QA_OPERATOR_REAUTHORIZED"], expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    }).select("id").single();
    if (insertError || typeof freshPolicy?.id !== "string") return "UNAVAILABLE";
    const { data: rebound, error: reboundError } = await privilegedClient.from("channel_outbound_actions")
      .update({ policy_decision_id: freshPolicy.id }).eq("id", action.id).eq("workspace_id", action.workspace_id)
      .eq("status", "APPROVED").eq("attempt_count", 0).eq("policy_decision_id", policy.id).select("id").maybeSingle();
    if (reboundError || !rebound) {
      await privilegedClient.from("channel_policy_decisions").delete().eq("id", freshPolicy.id).eq("workspace_id", action.workspace_id);
      return "NOT_ELIGIBLE";
    }
  }
  try {
    const loaded = await loadChannelAdapterByAccountId(action.channel_account_id);
    if (loaded.channelAccountId !== action.channel_account_id || loaded.adapter.channelType !== "ZALO") return "UNAVAILABLE";
    const registry = new ChannelAdapterRegistry();
    registry.register(loaded.adapter);
    const execution = await executeChannelOutboundAction(actionId, registry);
    return execution.status === "DEFERRED" ? "UNAVAILABLE" : execution.status === "FAILED" && execution.safeErrorCode === "ACCOUNT_BUSY" ? "BLOCKED" : execution.status;
  } catch { return "UNAVAILABLE"; }
}
