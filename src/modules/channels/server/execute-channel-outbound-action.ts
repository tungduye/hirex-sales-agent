import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import type { ChannelAdapterRegistry } from "../core/channel-adapter-registry";
import { CHANNEL_TYPES, type ChannelType, type SendAttachment } from "../core/channel-contracts";
import { executeOutboundAction, type ClaimedOutboundAction, type CurrentPolicyEvidence, type OutboundActionRecord } from "../core/execute-outbound-action";
import { isFacebookResponseWindowOpen } from "../core/facebook-response-window";
import { evaluateZaloProviderHealth, PROVIDER_HEALTH_STATUSES, type ProviderHealthStatus } from "../core/provider-health";

interface ActionRow {
  id: unknown; workspace_id: unknown; conversation_id: unknown; channel_account_id: unknown;
  channel_type: unknown; recipient_external_id: unknown; status: unknown; text_content: unknown;
  attachment_ids: unknown; idempotency_key: unknown; policy_decision_id: unknown;
  approved_by: unknown; approved_at: unknown;
}
interface AttachmentRow { id: unknown; storage_bucket: unknown; storage_path: unknown; filename: unknown; content_type: unknown; size_bytes: unknown; sha256: unknown }

function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value); }

type PrivilegedClient = ReturnType<typeof createPrivilegedClient>;

async function persistSentConversationMessage(client: PrivilegedClient, actionId: string, workspaceId: string) {
  const { data: action, error } = await client.from("channel_outbound_actions")
    .select("id,workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,text_content,provider_message_id,accepted_at")
    .eq("id", actionId).eq("workspace_id", workspaceId).eq("status", "SENT").maybeSingle();
  if (error || !action || !isUuid(action.conversation_id) || !isUuid(action.channel_account_id) ||
      typeof action.provider_message_id !== "string" || typeof action.accepted_at !== "string" ||
      typeof action.recipient_external_id !== "string" || typeof action.text_content !== "string") return false;
  const { data: account, error: accountError } = await client.from("channel_accounts")
    .select("external_account_id").eq("id", action.channel_account_id).eq("workspace_id", workspaceId).maybeSingle();
  if (accountError || typeof account?.external_account_id !== "string") return false;
  const { error: insertError } = await client.from("omnichannel_messages").upsert({
    workspace_id: workspaceId,
    conversation_id: action.conversation_id,
    channel_account_id: action.channel_account_id,
    channel_type: action.channel_type,
    provider_message_id: action.provider_message_id,
    direction: "OUTBOUND",
    sender_external_id: account.external_account_id,
    recipient_external_ids: [action.recipient_external_id],
    text_content: action.text_content,
    sent_at: action.accepted_at,
    metadata: { outboundActionId: actionId },
  }, { onConflict: "workspace_id,channel_account_id,provider_message_id", ignoreDuplicates: true });
  return !insertError;
}

async function mapAction(client: PrivilegedClient, row: ActionRow | null): Promise<OutboundActionRecord | null> {
  if (!row || !isUuid(row.id) || !isUuid(row.workspace_id) || (row.conversation_id !== null && !isUuid(row.conversation_id)) || !isUuid(row.channel_account_id) || typeof row.channel_type !== "string" || !CHANNEL_TYPES.includes(row.channel_type as ChannelType) || !["APPROVED","QUEUED","EXECUTING"].includes(String(row.status)) || typeof row.recipient_external_id !== "string" || (row.text_content !== null && typeof row.text_content !== "string") || !Array.isArray(row.attachment_ids) || !row.attachment_ids.every(isUuid) || typeof row.idempotency_key !== "string" || !isUuid(row.policy_decision_id) || !isUuid(row.approved_by) || typeof row.approved_at !== "string") return null;
  let providerConversationId: string | null = null;
  if (row.conversation_id) {
    const { data, error } = await client.from("omnichannel_conversations").select("provider_conversation_id").eq("id", row.conversation_id).eq("workspace_id", row.workspace_id).eq("channel_account_id", row.channel_account_id).maybeSingle();
    if (error || typeof data?.provider_conversation_id !== "string") return null;
    providerConversationId = data.provider_conversation_id;
  }
  return { id: row.id, workspaceId: row.workspace_id, conversationId: row.conversation_id, providerConversationId, channelAccountId: row.channel_account_id, channelType: row.channel_type as ChannelType, recipientExternalId: row.recipient_external_id, status: row.status as OutboundActionRecord["status"], textContent: row.text_content, attachmentIds: row.attachment_ids, idempotencyKey: row.idempotency_key, policyDecisionId: row.policy_decision_id, approvedBy: row.approved_by, approvedAt: row.approved_at };
}

export async function executeChannelOutboundAction(actionId: string, adapters: ChannelAdapterRegistry) {
  const client = createPrivilegedClient();
  const loadAction = async (id: string) => {
    const { data, error } = await client.from("channel_outbound_actions").select("id,workspace_id,conversation_id,channel_account_id,channel_type,recipient_external_id,status,text_content,attachment_ids,idempotency_key,policy_decision_id,approved_by,approved_at").eq("id", id).maybeSingle();
    return error ? null : mapAction(client, data as ActionRow | null);
  };
  return executeOutboundAction(actionId, {
    adapters,
    createLockId: randomUUID,
    now: () => new Date().toISOString(),
    async loadAction(id) {
      return loadAction(id);
    },
    async loadPolicy(id) {
      const { data, error } = await client.from("channel_policy_decisions").select("id,workspace_id,allowed,expires_at").eq("id", id).maybeSingle();
      if (error || !isUuid(data?.id) || !isUuid(data?.workspace_id) || typeof data?.allowed !== "boolean" || typeof data?.expires_at !== "string") return null;
      return { id: data.id, workspaceId: data.workspace_id, allowed: data.allowed, expiresAt: data.expires_at } satisfies CurrentPolicyEvidence;
    },
    async isSuppressed(input) {
      const { count, error } = await client.from("channel_suppressions").select("id", { count: "exact", head: true }).eq("workspace_id", input.workspaceId).eq("channel_type", input.channelType).eq("normalized_recipient", input.recipientExternalId.trim().toLowerCase());
      if (error) throw new Error("SUPPRESSION_CHECK_UNAVAILABLE");
      return (count ?? 0) > 0;
    },
    async claim(input) {
      const { data, error } = await client.rpc("claim_channel_outbound_action", { p_workspace_id: input.workspaceId, p_action_id: input.actionId, p_execution_lock_id: input.executionLockId });
      if (error || data !== true) return null;
      const action = await loadAction(input.actionId);
      if (!action) return null;
      if (action.status !== "EXECUTING") return null;
      return { ...action, status: "EXECUTING", executionLockId: input.executionLockId } satisfies ClaimedOutboundAction;
    },
    async loadClaimedAttachments(input) {
      if (input.attachmentIds.length === 0) return [];
      const { data: lock, error: lockError } = await client.from("channel_outbound_actions").select("id").eq("id", input.actionId).eq("workspace_id", input.workspaceId).eq("status", "EXECUTING").eq("execution_lock_id", input.executionLockId).maybeSingle();
      if (lockError || !lock) throw new Error("ATTACHMENT_LOCK_MISMATCH");
      const { data, error } = await client.from("channel_attachments").select("id,storage_bucket,storage_path,filename,content_type,size_bytes,sha256").eq("workspace_id", input.workspaceId).in("id", input.attachmentIds);
      if (error || data?.length !== input.attachmentIds.length) throw new Error("ATTACHMENT_UNAVAILABLE");
      const byId = new Map((data as AttachmentRow[]).map((row) => [row.id, row]));
      const attachments: SendAttachment[] = [];
      for (const id of input.attachmentIds) {
        const row = byId.get(id);
        if (!row || !isUuid(row.id) || typeof row.storage_bucket !== "string" || typeof row.storage_path !== "string" || typeof row.filename !== "string" || typeof row.content_type !== "string" || !Number.isSafeInteger(row.size_bytes) || typeof row.sha256 !== "string") throw new Error("ATTACHMENT_INVALID");
        const { data: blob, error: downloadError } = await client.storage.from(row.storage_bucket).download(row.storage_path);
        if (downloadError || !blob) throw new Error("ATTACHMENT_MISSING");
        const bytes = Buffer.from(await blob.arrayBuffer());
        if (bytes.length !== row.size_bytes || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("ATTACHMENT_INTEGRITY_FAILED");
        attachments.push({ id, filename: row.filename, contentType: row.content_type, sizeBytes: bytes.length, sha256: row.sha256, contentBase64: bytes.toString("base64") });
      }
      return attachments;
    },
    async validatePreSend({ action, now }) {
      if(action.channelType==="ZALO"){
        const accountResult=await client.from("channel_accounts").select("id,workspace_id,operator_enabled,provider_health_status,provider_health_checked_at").eq("id",action.channelAccountId).eq("workspace_id",action.workspaceId).eq("channel_type","ZALO").eq("provider","ZALO_BRIDGE").eq("status","CONNECTED").maybeSingle();
        const account=accountResult.data;
        if(accountResult.error||!account||account.operator_enabled!==true)return{allowed:false,safeErrorCode:"ACCOUNT_UNAVAILABLE"};
        const adapter=adapters.get("ZALO"),started=Date.now(),rawHealth=await adapter.healthCheck(action.channelAccountId),health:ProviderHealthStatus=PROVIDER_HEALTH_STATUSES.includes(rawHealth as ProviderHealthStatus)?rawHealth as ProviderHealthStatus:"UNKNOWN",checkedAt=new Date().toISOString();
        const recorded=await client.rpc("record_channel_account_provider_health",{p_workspace_id:action.workspaceId,p_channel_account_id:action.channelAccountId,p_status:health,p_checked_at:checkedAt,p_safe_reason_code:health==="HEALTHY"?null:health,p_latency_ms:Math.min(Date.now()-started,60000)});
        if(recorded.error||recorded.data!==true)throw new Error("ZALO_HEALTH_PERSISTENCE_UNAVAILABLE");
        const eligibility=evaluateZaloProviderHealth({operatorEnabled:true,status:health,checkedAt},new Date(now));
        return{allowed:eligibility.allowed,safeErrorCode:eligibility.allowed?"":"ACCOUNT_UNAVAILABLE"};
      }
      if (action.channelType !== "FACEBOOK") return { allowed: true, safeErrorCode: "" };
      if (!action.conversationId || !action.providerConversationId || action.providerConversationId !== action.recipientExternalId) return { allowed: false, safeErrorCode: "FACEBOOK_RESPONSE_WINDOW_EXPIRED" };
      const { data: conversation, error: conversationError } = await client.from("omnichannel_conversations")
        .select("id,status,channel_account_id,provider_conversation_id")
        .eq("id", action.conversationId).eq("workspace_id", action.workspaceId)
        .eq("channel_account_id", action.channelAccountId).eq("channel_type", "FACEBOOK")
        .eq("provider_conversation_id", action.recipientExternalId).maybeSingle();
      if (conversationError || !conversation || conversation.id !== action.conversationId || conversation.channel_account_id !== action.channelAccountId || conversation.provider_conversation_id !== action.recipientExternalId) throw new Error("FACEBOOK_RESPONSE_WINDOW_UNAVAILABLE");
      const { data: inbound, error: inboundError } = await client.from("omnichannel_messages")
        .select("sent_at").eq("workspace_id", action.workspaceId).eq("conversation_id", action.conversationId)
        .eq("channel_account_id", action.channelAccountId).eq("channel_type", "FACEBOOK").eq("direction", "INBOUND")
        .order("sent_at", { ascending: false }).limit(1).maybeSingle();
      if (inboundError) throw new Error("FACEBOOK_RESPONSE_WINDOW_UNAVAILABLE");
      return { allowed: isFacebookResponseWindowOpen({ status: conversation.status, latestInboundAt: inbound?.sent_at }, new Date(now)), safeErrorCode: "FACEBOOK_RESPONSE_WINDOW_EXPIRED" };
    },
    async finalizeSent(input) {
      const { data, error } = await client.rpc("finalize_channel_outbound_action_sent", { p_workspace_id: input.workspaceId, p_action_id: input.actionId, p_execution_lock_id: input.executionLockId, p_provider_message_id: input.providerMessageId, p_provider_conversation_id: input.providerConversationId, p_accepted_at: input.acceptedAt });
      if (error || data !== true) return false;
      // The durable action is authoritative: a read-model failure must never trigger a resend.
      try { await persistSentConversationMessage(client, input.actionId, input.workspaceId); } catch { /* action remains SENT */ }
      return true;
    },
    async finalizeFailed(input) {
      const { data, error } = await client.rpc("finalize_channel_outbound_action_failed", { p_workspace_id: input.workspaceId, p_action_id: input.actionId, p_execution_lock_id: input.executionLockId, p_safe_error_code: input.safeErrorCode });
      return !error && data === true;
    },
    async finalizeUnknown(input) {
      const { data, error } = await client.rpc("finalize_channel_outbound_action_unknown", { p_workspace_id: input.workspaceId, p_action_id: input.actionId, p_execution_lock_id: input.executionLockId });
      return !error && data === true;
    },
  });
}
