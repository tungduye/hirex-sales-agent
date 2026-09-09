import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CanonicalInboundMessage,
  ChannelAdapter,
  ChannelSendResult,
  SendMessageCommand,
  VerifiedWebhook,
} from "../../core/channel-contracts";
import { ChannelError } from "../../core/channel-errors";
import type { ChannelTransport } from "../../core/channel-transport";
import type { FacebookPageCredential, FacebookWebhookEnvelope } from "./facebook-contracts";

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function parseEnvelope(value: unknown): FacebookWebhookEnvelope {
  if (!value || typeof value !== "object") throw new ChannelError("INVALID_WEBHOOK", false);
  const envelope = value as Partial<FacebookWebhookEnvelope>;
  if (envelope.object !== "page" || !Array.isArray(envelope.entry)) {
    throw new ChannelError("INVALID_WEBHOOK", false);
  }
  return envelope as FacebookWebhookEnvelope;
}

export class FacebookPageAdapter implements ChannelAdapter {
  private readonly channelAccountId:string;
  private readonly workspaceId:string;
  private readonly credential:FacebookPageCredential;
  private readonly transport:ChannelTransport;
  readonly channelType = "FACEBOOK" as const;
  readonly capabilities = new Set([
    "SEND_TEXT",
    "REPLY",
    "DELIVERY_RECEIPTS",
    "READ_RECEIPTS",
  ] as const);

  constructor(
    channelAccountId: string,
    workspaceId: string,
    credential: FacebookPageCredential,
    transport: ChannelTransport,
  ) {this.channelAccountId=channelAccountId;this.workspaceId=workspaceId;this.credential=credential;this.transport=transport;}

  async verifyWebhook(input: {
    headers: Readonly<Record<string, string>>;
    body: string;
  }): Promise<VerifiedWebhook> {
    const signature = input.headers["x-hub-signature-256"];
    if (!signature?.startsWith("sha256=")) throw new ChannelError("INVALID_WEBHOOK", false);
    const expected = `sha256=${createHmac("sha256", this.credential.appSecret).update(input.body).digest("hex")}`;
    if (!safeEqual(signature, expected)) throw new ChannelError("INVALID_WEBHOOK", false);

    let payload: unknown;
    try {
      payload = JSON.parse(input.body);
    } catch {
      throw new ChannelError("INVALID_WEBHOOK", false);
    }
    const envelope = parseEnvelope(payload);
    if (envelope.entry.some((entry) => entry.id !== this.credential.pageId)) {
      throw new ChannelError("INVALID_WEBHOOK", false);
    }
    return {
      channelAccountId: this.channelAccountId,
      providerEventId: null,
      receivedAt: new Date().toISOString(),
      payload: envelope,
    };
  }

  async normalizeInbound(input: VerifiedWebhook): Promise<CanonicalInboundMessage[]> {
    const envelope = parseEnvelope(input.payload);
    const messages: CanonicalInboundMessage[] = [];
    for (const entry of envelope.entry) {
      for (const event of entry.messaging ?? []) {
        const senderId = event.sender?.id;
        const recipientId = event.recipient?.id;
        const messageId = event.message?.mid;
        const occurredAt = event.timestamp;
        if (!senderId || !recipientId || !messageId || !occurredAt) continue;
        const attachments = (event.message?.attachments ?? []).flatMap((attachment, index) => {
          const providerUrl = attachment.payload?.url;
          if (!providerUrl) return [];
          return [{
            externalId: `${messageId}:${index}`,
            filename: null,
            contentType: attachment.type ?? null,
            sizeBytes: null,
            providerUrl,
          }];
        });
        if (!event.message?.text && attachments.length === 0) continue;
        messages.push({
          workspaceId: this.workspaceId,
          channelAccountId: this.channelAccountId,
          channelType: "FACEBOOK",
          providerConversationId: senderId,
          providerMessageId: messageId,
          providerEventId: messageId,
          sender: { contactId: null, channelType: "FACEBOOK", externalId: senderId, displayName: null },
          recipients: [{ contactId: null, channelType: "FACEBOOK", externalId: recipientId, displayName: null }],
          text: event.message?.text ?? null,
          attachments,
          occurredAt: new Date(occurredAt).toISOString(),
          rawPayloadReference: null,
        });
      }
    }
    return messages;
  }

  async sendMessage(command: SendMessageCommand): Promise<ChannelSendResult> {
    if (command.workspaceId !== this.workspaceId || command.channelAccountId !== this.channelAccountId || command.channelType !== "FACEBOOK") {
      throw new ChannelError("ACCOUNT_UNAVAILABLE", false);
    }
    if (!command.text || command.attachments.length > 0) throw new ChannelError("DELIVERY_REJECTED", false);
    const response = await this.transport.request({
      method: "POST",
      url: `https://graph.facebook.com/${encodeURIComponent(this.credential.graphApiVersion)}/${encodeURIComponent(this.credential.pageId)}/messages`,
      headers: { authorization: `Bearer ${this.credential.pageAccessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: command.recipientExternalId }, message: { text: command.text }, messaging_type: "RESPONSE" }),
      timeoutMs: 15_000,
    });
    if (response.status === 401 || response.status === 403) throw new ChannelError("PERMISSION_DENIED", false);
    if (response.status === 429) throw new ChannelError("RATE_LIMITED", true);
    if (response.status < 200 || response.status >= 300) throw new ChannelError(response.status >= 500 ? "DELIVERY_UNKNOWN" : "DELIVERY_REJECTED", response.status >= 500);
    const body = response.body as { message_id?: unknown };
    if (typeof body?.message_id !== "string" || !body.message_id) throw new ChannelError("DELIVERY_UNKNOWN", false);
    return { providerMessageId: body.message_id, providerConversationId: command.recipientExternalId, acceptedAt: new Date().toISOString() };
  }

  async healthCheck(): Promise<"CONNECTED" | "REAUTH_REQUIRED" | "ERROR"> {
    const response = await this.transport.request({
      method: "GET",
      url: `https://graph.facebook.com/${encodeURIComponent(this.credential.graphApiVersion)}/${encodeURIComponent(this.credential.pageId)}?fields=id`,
      headers: { authorization: `Bearer ${this.credential.pageAccessToken}` },
      timeoutMs: 10_000,
    });
    if (response.status === 401 || response.status === 403) return "REAUTH_REQUIRED";
    return response.status >= 200 && response.status < 300 ? "CONNECTED" : "ERROR";
  }
}
