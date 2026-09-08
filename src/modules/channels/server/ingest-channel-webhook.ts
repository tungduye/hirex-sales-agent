import "server-only";

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
    const { data: conversation, error: conversationError } = await client.from("omnichannel_conversations").upsert({ workspace_id: account.workspace_id, channel_account_id: account.id, channel_type: input.channelType, provider_conversation_id: message.providerConversationId, status: "OPEN", last_message_at: message.occurredAt, metadata: { participantExternalId: message.sender.externalId, participantDisplayName: message.sender.displayName } }, { onConflict: "workspace_id,channel_account_id,provider_conversation_id" }).select("id").single();
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
