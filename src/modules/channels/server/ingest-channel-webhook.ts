import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import type { CanonicalInboundMessage, ChannelAdapter, ChannelType } from "../core/channel-contracts";
import { zaloContactIdentity } from "../core/zalo-account-policy";
import { mayUpgradeZaloAccountName, mayUpgradeZaloContactName, zaloContactDisplayName } from "../core/zalo-display-identity";
import { runMessageReceivedAutomations } from "./run-channel-automations";
import { enqueueAiRecruiterInbound } from "@/modules/ai-recruiter/server/enqueue-ai-recruiter";

export async function resolveConnectedChannelAccount(channelType: ChannelType, provider: string, externalAccountId: string) {
  const client = createPrivilegedClient();
  const { data, error } = await client.from("channel_accounts").select("id,workspace_id").eq("channel_type", channelType).eq("provider", provider).eq("external_account_id", externalAccountId).eq("status", "CONNECTED").maybeSingle();
  if (error || typeof data?.id !== "string" || typeof data.workspace_id !== "string") throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");
  return { id: data.id, workspaceId: data.workspace_id };
}

function safeText(value: string | null, max = 100_000) {
  return value === null || (value.length <= max && !value.includes("\u0000"));
}

async function persistEmbeddedFacebookProfileAttachments(input: {
  client: ReturnType<typeof createPrivilegedClient>;
  workspaceId: string;
  messageId: string;
  attachments: CanonicalInboundMessage["attachments"];
}) {
  const bucket = "email-attachments";
  for (const [position, attachment] of input.attachments.entries()) {
    if (!attachment.providerUrl?.startsWith("data:image/")) continue;
    const existingLink = await input.client.from("channel_message_attachments").select("attachment_id")
      .eq("workspace_id", input.workspaceId).eq("message_id", input.messageId).eq("position", position).maybeSingle();
    if (existingLink.error) throw new Error("ATTACHMENT_PERSISTENCE_FAILED");
    if (existingLink.data) continue;
    const match = attachment.providerUrl.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/u);
    if (!match) throw new Error("ATTACHMENT_INVALID");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw new Error("ATTACHMENT_INVALID");
    const id = randomUUID(), digest = createHash("sha256").update(bytes).digest("hex");
    const extension = match[1] === "image/png" ? "png" : "jpg";
    const filename = (attachment.filename?.trim() || `facebook-image-${position + 1}.${extension}`).slice(0, 255);
    const storagePath = `${input.workspaceId}/facebook-profile/${input.messageId}/${id}.${extension}`;
    const uploaded = await input.client.storage.from(bucket).upload(storagePath, bytes, { contentType: match[1], upsert: false });
    if (uploaded.error) throw new Error("ATTACHMENT_STORAGE_FAILED");
    const metadata = await input.client.from("channel_attachments").insert({ id, workspace_id: input.workspaceId, storage_bucket: bucket, storage_path: storagePath, filename, content_type: match[1], size_bytes: bytes.length, sha256: digest, source: "INBOUND_PROVIDER" });
    if (metadata.error) { await input.client.storage.from(bucket).remove([storagePath]); throw new Error("ATTACHMENT_PERSISTENCE_FAILED"); }
    const link = await input.client.from("channel_message_attachments").insert({ workspace_id: input.workspaceId, message_id: input.messageId, attachment_id: id, position });
    if (link.error) { await input.client.from("channel_attachments").delete().eq("id", id); await input.client.storage.from(bucket).remove([storagePath]); throw new Error("ATTACHMENT_PERSISTENCE_FAILED"); }
  }
}

async function resolveContactIdentity(input: {
  client: ReturnType<typeof createPrivilegedClient>;
  workspaceId: string;
  channelAccountId: string;
  channelType: ChannelType;
  externalId: string;
  providerConversationId: string;
  displayName: string | null;
}) {
  if (input.channelType !== "ZALO") {
    const lookup = await input.client.from("contact_channels").select("contact_id").eq("workspace_id", input.workspaceId)
      .eq("channel_type", input.channelType).eq("channel_value", input.externalId).limit(2);
    if (lookup.error || (lookup.data?.length ?? 0) > 1) throw new Error("CONTACT_IDENTITY_UNAVAILABLE");
    return typeof lookup.data?.[0]?.contact_id === "string" ? lookup.data[0].contact_id : null;
  }

  // Existing single-account QA rows predate account-scoped contact metadata.
  // Reuse one only when its conversation already proves ownership by this account.
  const previous = await input.client.from("omnichannel_conversations").select("contact_id")
    .eq("workspace_id", input.workspaceId).eq("channel_account_id", input.channelAccountId)
    .eq("provider_conversation_id", input.providerConversationId).limit(2);
  if (previous.error || (previous.data?.length ?? 0) > 1) throw new Error("CONTACT_IDENTITY_UNAVAILABLE");
  if (typeof previous.data?.[0]?.contact_id === "string") return previous.data[0].contact_id;

  // Stable IDs make concurrent/retried first inbound delivery idempotent without
  // trusting a browser-supplied contact or widening provider identity scope.
  const { contactId, channelId } = zaloContactIdentity(input.workspaceId, input.channelAccountId, input.externalId);
  const contact = await input.client.from("contacts").upsert({
    id: contactId, workspace_id: input.workspaceId,
    full_name: zaloContactDisplayName(input.externalId, input.displayName), source: "ZALO_INBOUND",
  }, { onConflict: "id", ignoreDuplicates: true });
  if (contact.error) throw new Error("CONTACT_PERSISTENCE_FAILED");
  const channel = await input.client.from("contact_channels").upsert({
    id: channelId, workspace_id: input.workspaceId, contact_id: contactId,
    channel_type: "ZALO", channel_value: input.externalId, is_primary: true,
    metadata: { channelAccountId: input.channelAccountId },
  }, { onConflict: "id", ignoreDuplicates: true });
  if (channel.error) throw new Error("CONTACT_CHANNEL_PERSISTENCE_FAILED");
  return contactId;
}

async function refreshZaloIdentity(input: {
  client: ReturnType<typeof createPrivilegedClient>;
  workspaceId: string;
  accountId: string;
  externalId: string;
  contactId: string | null;
  contactName: string | null;
  accountName: string | null | undefined;
}) {
  if (input.contactId && input.contactName) {
    const contact = await input.client.from("contacts").select("full_name").eq("id", input.contactId)
      .eq("workspace_id", input.workspaceId).maybeSingle();
    if (contact.error) throw new Error("CONTACT_IDENTITY_UNAVAILABLE");
    const oldName = contact.data?.full_name;
    if (mayUpgradeZaloContactName(oldName, input.externalId)) {
      const updated = await input.client.from("contacts").update({ full_name: input.contactName })
        .eq("id", input.contactId).eq("workspace_id", input.workspaceId).eq("full_name", oldName);
      if (updated.error) throw new Error("CONTACT_PERSISTENCE_FAILED");
    }
  }
  if (input.accountName) {
    const account = await input.client.from("channel_accounts").select("display_name,external_account_id").eq("id", input.accountId)
      .eq("workspace_id", input.workspaceId).eq("channel_type", "ZALO").maybeSingle();
    if (account.error) throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");
    const oldName = account.data?.display_name;
    if (mayUpgradeZaloAccountName(oldName, account.data?.external_account_id ?? "")) {
      const query = input.client.from("channel_accounts").update({ display_name: input.accountName })
        .eq("id", input.accountId).eq("workspace_id", input.workspaceId).eq("channel_type", "ZALO");
      const updated = await (oldName === null ? query.is("display_name", null) : query.eq("display_name", oldName));
      if (updated.error) throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");
    }
  }
}

function isCanonical(message: CanonicalInboundMessage, channelType: ChannelType, accountId: string) {
  return message.channelType === channelType && message.channelAccountId === accountId &&
    (message.direction === undefined || message.direction === "INBOUND" || message.direction === "OUTBOUND") &&
    message.workspaceId.length > 0 && message.providerConversationId.length > 0 && message.providerConversationId.length <= 512 &&
    message.providerMessageId.length > 0 && message.providerMessageId.length <= 512 && message.sender.externalId.length > 0 &&
    safeText(message.text) && Number.isFinite(Date.parse(message.occurredAt)) && message.attachments.length <= 20;
}

export async function ingestChannelWebhook(input: {
  adapter: ChannelAdapter;
  channelAccountId: string;
  channelType: ChannelType;
  headers: Readonly<Record<string, string>>;
  body: string;
}) {
  const verified = await input.adapter.verifyWebhook({ headers: input.headers, body: input.body });
  if (verified.channelAccountId !== input.channelAccountId) throw new Error("WEBHOOK_ACCOUNT_MISMATCH");
  const messages = await input.adapter.normalizeInbound(verified);
  if (messages.length > 100 || !messages.every((message) => isCanonical(message, input.channelType, input.channelAccountId))) throw new Error("WEBHOOK_PAYLOAD_INVALID");
  const client = createPrivilegedClient();
  const { data: account, error: accountError } = await client.from("channel_accounts").select("id,workspace_id,external_account_id,status,channel_type,operator_enabled,provider_health_status").eq("id", input.channelAccountId).eq("channel_type", input.channelType).eq("status", "CONNECTED").maybeSingle();
  if (accountError || !account || typeof account.workspace_id !== "string" ||
      (input.channelType === "ZALO" && (account.operator_enabled !== true || !["HEALTHY", "DEGRADED"].includes(account.provider_health_status))))
    throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");

  let accepted = 0;
  for (const message of messages) {
    if (message.workspaceId !== account.workspace_id) throw new Error("WEBHOOK_WORKSPACE_MISMATCH");
    const direction = message.direction ?? "INBOUND";
    const participant = direction === "OUTBOUND" ? message.recipients[0] : message.sender;
    if (direction === "OUTBOUND" && (!["FACEBOOK", "ZALO", "FACEBOOK_PROFILE"].includes(input.channelType) || message.sender.externalId !== account.external_account_id || message.recipients.length !== 1))
      throw new Error("WEBHOOK_DIRECTION_INVALID");
    if (input.channelType === "FACEBOOK_PROFILE" && direction === "OUTBOUND" && message.text) {
      const recentConversation = await client.from("omnichannel_conversations").select("id")
        .eq("workspace_id", account.workspace_id).eq("channel_account_id", account.id)
        .eq("provider_conversation_id", message.providerConversationId).maybeSingle();
      if (recentConversation.error) throw new Error("CONVERSATION_PERSISTENCE_FAILED");
      if (recentConversation.data?.id) {
        const recentEcho = await client.from("omnichannel_messages").select("id")
          .eq("workspace_id", account.workspace_id).eq("conversation_id", recentConversation.data.id)
          .eq("direction", "OUTBOUND").eq("text_content", message.text)
          .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString()).limit(1).maybeSingle();
        if (recentEcho.error) throw new Error("MESSAGE_PERSISTENCE_FAILED");
        if (recentEcho.data) continue;
      }
    }
    const eventKey = message.providerEventId ?? `message:${message.providerMessageId}`;
    const { data: event, error: eventError } = await client.rpc("claim_channel_inbound_event", {
      p_workspace_id: account.workspace_id, p_channel_account_id: account.id,
      p_provider_event_id: eventKey, p_received_at: verified.receivedAt,
    }).single<{ event_id: unknown; claim_token: unknown; claim_status: unknown }>();
    if (eventError || !event) throw new Error("INBOUND_EVENT_UNAVAILABLE");
    if (event.claim_status === "PROCESSED" || event.claim_status === "BUSY") continue;
    if (event.claim_status !== "CLAIMED" || typeof event.event_id !== "string" || typeof event.claim_token !== "string")
      throw new Error("INBOUND_EVENT_UNAVAILABLE");
    try {
    const contactId=await resolveContactIdentity({client,workspaceId:account.workspace_id,channelAccountId:account.id,channelType:input.channelType,
      externalId:participant.externalId,providerConversationId:message.providerConversationId,displayName:participant.displayName});
    if (input.channelType === "ZALO" && direction === "INBOUND") await refreshZaloIdentity({ client, workspaceId: account.workspace_id,
      accountId: account.id, externalId: participant.externalId, contactId,
      contactName: participant.displayName, accountName: message.accountDisplayName });
    const previousConversation = await client.from("omnichannel_conversations").select("metadata")
      .eq("workspace_id", account.workspace_id).eq("channel_account_id", account.id)
      .eq("provider_conversation_id", message.providerConversationId).maybeSingle();
    if (previousConversation.error) throw new Error("CONVERSATION_PERSISTENCE_FAILED");
    const existingMetadata = previousConversation.data?.metadata;
    const metadata = existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? existingMetadata : {};
    // History reconciliation may already know the group name/avatar. An
    // individual sender in that group must not replace the group's identity.
    const participantMetadata = participant.displayName && metadata.conversationKind !== "GROUP"
      ? { metadata: { ...metadata, participantExternalId: participant.externalId, participantDisplayName: participant.displayName } }
      : {};
    const { data: conversation, error: conversationError } = await client.from("omnichannel_conversations").upsert({ workspace_id: account.workspace_id, channel_account_id: account.id, channel_type: input.channelType, provider_conversation_id: message.providerConversationId, ...(contactId?{contact_id:contactId}:{}), last_message_at: message.occurredAt, ...participantMetadata }, { onConflict: "workspace_id,channel_account_id,provider_conversation_id" }).select("id").single();
    if (conversationError || !conversation) throw new Error("CONVERSATION_PERSISTENCE_FAILED");
    const metadataAttachments=message.attachments.map(attachment=>({...attachment,providerUrl:attachment.providerUrl?.startsWith("data:")?null:attachment.providerUrl}));
    const { data: insertedMessage, error: messageError } = await client.from("omnichannel_messages").upsert({ workspace_id: account.workspace_id, conversation_id: conversation.id, channel_account_id: account.id, channel_type: input.channelType, provider_message_id: message.providerMessageId, provider_event_id: message.providerEventId, direction, sender_external_id: message.sender.externalId, recipient_external_ids: message.recipients.map((recipient) => recipient.externalId), text_content: message.text, attachment_count: message.attachments.length, ...(direction === "INBOUND" ? { received_at: message.occurredAt } : { sent_at: message.occurredAt }), metadata: { rawPayloadReference: message.rawPayloadReference, attachments: metadataAttachments } }, { onConflict: "workspace_id,channel_account_id,provider_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (messageError) throw new Error("MESSAGE_PERSISTENCE_FAILED");
    let messageId=insertedMessage?.id;
    if(typeof messageId!=="string"){const existing=await client.from("omnichannel_messages").select("id").eq("workspace_id",account.workspace_id).eq("channel_account_id",account.id).eq("provider_message_id",message.providerMessageId).maybeSingle();messageId=existing.data?.id}
    if(typeof messageId!=="string")throw new Error("MESSAGE_PERSISTENCE_FAILED");
    if (input.channelType === "FACEBOOK_PROFILE" && message.attachments.length > 0)
      await persistEmbeddedFacebookProfileAttachments({ client, workspaceId: account.workspace_id, messageId, attachments: message.attachments });
    // Automation runs deduplicate on message ID + definition version, including
    // a retry that resumes after the message was persisted but before completion.
    if (direction === "INBOUND") {
      await runMessageReceivedAutomations({workspaceId:account.workspace_id,conversationId:conversation.id,channelType:input.channelType,messageId,providerMessageId:message.providerMessageId,senderExternalId:message.sender.externalId,text:message.text});
      try { await enqueueAiRecruiterInbound({workspaceId:account.workspace_id,channelAccountId:account.id,conversationId:conversation.id,messageId}); } catch { /* AI queue must never fail channel ingestion. */ }
    }
    const completed = await client.from("channel_inbound_events").update({
      status: "PROCESSED", processed_at: new Date().toISOString(), processing_token: null,
      processing_lease_expires_at: null, safe_error_code: null,
    }).eq("id", event.event_id).eq("status", "PROCESSING").eq("processing_token", event.claim_token).select("id").maybeSingle();
    if (completed.error || !completed.data) throw new Error("INBOUND_EVENT_UNAVAILABLE");
    accepted += 1;
    } catch (error) {
      // Never clear another worker's lease after this worker timed out. If this
      // update also fails, the lease expires and a later provider replay resumes.
      try {
        await client.from("channel_inbound_events").update({ status: "FAILED", safe_error_code: "INGEST_RETRY_REQUIRED",
          processing_token: null, processing_lease_expires_at: null })
          .eq("id", event.event_id).eq("status", "PROCESSING").eq("processing_token", event.claim_token);
      } catch { /* Preserve the original failure; the caller must retry. */ }
      throw error;
    }
  }
  return { accepted };
}
