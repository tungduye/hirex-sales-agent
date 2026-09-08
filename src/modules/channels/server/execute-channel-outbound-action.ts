import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import type { ChannelAdapterRegistry } from "../core/channel-adapter-registry";
import { CHANNEL_TYPES, type ChannelType, type SendAttachment } from "../core/channel-contracts";
import { executeOutboundAction, type ClaimedOutboundAction, type CurrentPolicyEvidence, type OutboundActionRecord } from "../core/execute-outbound-action";

interface ActionRow {
  id: unknown; workspace_id: unknown; conversation_id: unknown; channel_account_id: unknown;
  channel_type: unknown; recipient_external_id: unknown; status: unknown; text_content: unknown;
  attachment_ids: unknown; idempotency_key: unknown; policy_decision_id: unknown;
  approved_by: unknown; approved_at: unknown;
}
interface AttachmentRow { id: unknown; storage_bucket: unknown; storage_path: unknown; filename: unknown; content_type: unknown; size_bytes: unknown; sha256: unknown }

function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value); }

type PrivilegedClient = ReturnType<typeof createPrivilegedClient>;

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
    async finalizeSent(input) {
      const { data, error } = await client.rpc("finalize_channel_outbound_action_sent", { p_workspace_id: input.workspaceId, p_action_id: input.actionId, p_execution_lock_id: input.executionLockId, p_provider_message_id: input.providerMessageId, p_provider_conversation_id: input.providerConversationId, p_accepted_at: input.acceptedAt });
      return !error && data === true;
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
