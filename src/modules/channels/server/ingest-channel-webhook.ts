import "server-only";

import { createHash } from "node:crypto";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import type { CanonicalInboundMessage, ChannelAdapter, ChannelType } from "../core/channel-contracts";
import { runMessageReceivedAutomations } from "./run-channel-automations";

export async function resolveConnectedChannelAccount(channelType: ChannelType, provider: string, externalAccountId: string) {
  const client = createPrivilegedClient();
  const { data, error } = await client.from("channel_accounts").select("id,workspace_id").eq("channel_type", channelType).eq("provider", provider).eq("external_account_id", externalAccountId).eq("status", "CONNECTED").maybeSingle();
  if (error || typeof data?.id !== "string" || typeof data.workspace_id !== "string") throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");
  return { id: data.id, workspaceId: data.workspace_id };
}

function safeText(value: string | null, max = 100_000) {
  return value === null || (value.length <= max && !value.includes("\u0000"));
}

function deterministicUuid(namespace: string) {
  const hex = createHash("sha256").update(namespace).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function resolveContactIdentity(input: {
  client: ReturnType<typeof createPrivilegedClient>;
  workspaceId: string;
  channelType: ChannelType;
  externalId: string;
  displayName: string | null;
}) {
  const lookup = await input.client.from("contact_channels").select("contact_id").eq("workspace_id", input.workspaceId)
    .eq("channel_type", input.channelType).eq("channel_value", input.externalId).limit(2);
  if (lookup.error) throw new Error("CONTACT_IDENTITY_UNAVAILABLE");
  if ((lookup.data?.length ?? 0) > 1) throw new Error("CONTACT_IDENTITY_AMBIGUOUS");
  if (typeof lookup.data?.[0]?.contact_id === "string") return lookup.data[0].contact_id;
  if (input.channelType !== "ZALO") return null;

  // Stable IDs make concurrent/retried first inbound delivery idempotent without
  // trusting a browser-supplied contact or widening provider identity scope.
  const contactId = deterministicUuid(`hirex:contact:${input.workspaceId}:${input.channelType}:${input.externalId}`);
  const channelId = deterministicUuid(`hirex:contact-channel:${input.workspaceId}:${input.channelType}:${input.externalId}`);
  const contact = await input.client.from("contacts").upsert({
    id: contactId, workspace_id: input.workspaceId,
    full_name: input.displayName?.trim() || "Zalo contact", source: "ZALO_INBOUND",
  }, { onConflict: "id", ignoreDuplicates: true });
  if (contact.error) throw new Error("CONTACT_PERSISTENCE_FAILED");
  const channel = await input.client.from("contact_channels").upsert({
    id: channelId, workspace_id: input.workspaceId, contact_id: contactId,
    channel_type: "ZALO", channel_value: input.externalId, is_primary: true,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (channel.error) throw new Error("CONTACT_CHANNEL_PERSISTENCE_FAILED");
  return contactId;
}

function isCanonical(message: CanonicalInboundMessage, channelType: ChannelType, accountId: string) {
  return message.channelType === channelType && message.channelAccountId === accountId &&
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
  const { data: account, error: accountError } = await client.from("channel_accounts").select("id,workspace_id,status,channel_type").eq("id", input.channelAccountId).eq("channel_type", input.channelType).eq("status", "CONNECTED").maybeSingle();
  if (accountError || !account || typeof account.workspace_id !== "string") throw new Error("CHANNEL_ACCOUNT_UNAVAILABLE");

  let accepted = 0;
  for (const message of messages) {
    if (message.workspaceId !== account.workspace_id) throw new Error("WEBHOOK_WORKSPACE_MISMATCH");
    const eventKey = message.providerEventId ?? `message:${message.providerMessageId}`;
    const { data: event, error: eventError } = await client.from("channel_inbound_events").upsert({ workspace_id: account.workspace_id, channel_account_id: account.id, provider_event_id: eventKey, event_type: "MESSAGE", payload_reference: `provider-event:${eventKey}`, status: "PROCESSING", received_at: verified.receivedAt }, { onConflict: "workspace_id,channel_account_id,provider_event_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (eventError) throw new Error("INBOUND_EVENT_UNAVAILABLE");
    if (!event) continue;
    const contactId=await resolveContactIdentity({client,workspaceId:account.workspace_id,channelType:input.channelType,
      externalId:message.sender.externalId,displayName:message.sender.displayName});
    const { data: conversation, error: conversationError } = await client.from("omnichannel_conversations").upsert({ workspace_id: account.workspace_id, channel_account_id: account.id, channel_type: input.channelType, provider_conversation_id: message.providerConversationId, ...(contactId?{contact_id:contactId}:{}), last_message_at: message.occurredAt, metadata: { participantExternalId: message.sender.externalId, participantDisplayName: message.sender.displayName } }, { onConflict: "workspace_id,channel_account_id,provider_conversation_id" }).select("id").single();
    if (conversationError || !conversation) throw new Error("CONVERSATION_PERSISTENCE_FAILED");
    const { data: insertedMessage, error: messageError } = await client.from("omnichannel_messages").upsert({ workspace_id: account.workspace_id, conversation_id: conversation.id, channel_account_id: account.id, channel_type: input.channelType, provider_message_id: message.providerMessageId, provider_event_id: message.providerEventId, direction: "INBOUND", sender_external_id: message.sender.externalId, recipient_external_ids: message.recipients.map((recipient) => recipient.externalId), text_content: message.text, attachment_count: message.attachments.length, received_at: message.occurredAt, metadata: { rawPayloadReference: message.rawPayloadReference, attachments: message.attachments } }, { onConflict: "workspace_id,channel_account_id,provider_message_id", ignoreDuplicates: true }).select("id").maybeSingle();
    if (messageError) throw new Error("MESSAGE_PERSISTENCE_FAILED");
    let messageId=insertedMessage?.id;
    if(typeof messageId!=="string"){const existing=await client.from("omnichannel_messages").select("id").eq("workspace_id",account.workspace_id).eq("channel_account_id",account.id).eq("provider_message_id",message.providerMessageId).maybeSingle();messageId=existing.data?.id}
    if(typeof messageId!=="string")throw new Error("MESSAGE_PERSISTENCE_FAILED");
    await runMessageReceivedAutomations({workspaceId:account.workspace_id,conversationId:conversation.id,channelType:input.channelType,messageId,providerMessageId:message.providerMessageId,senderExternalId:message.sender.externalId,text:message.text});
    await client.from("channel_inbound_events").update({ status: "PROCESSED", processed_at: new Date().toISOString() }).eq("id", event.id).eq("status", "PROCESSING");
    accepted += 1;
  }
  return { accepted };
}
