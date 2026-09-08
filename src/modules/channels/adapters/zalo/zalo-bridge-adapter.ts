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
import type { ZaloBridgeCredential, ZaloBridgeEvent } from "./zalo-bridge-contracts";

const MAX_CLOCK_SKEW_SECONDS = 300;

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function isString(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function parseEvent(value: unknown): ZaloBridgeEvent {
  if (!value || typeof value !== "object") throw new ChannelError("INVALID_WEBHOOK", false);
  const event = value as Partial<ZaloBridgeEvent>;
  if (
    !isString(event.eventId) ||
    !isString(event.accountId) ||
    !isString(event.threadId) ||
    !isString(event.messageId) ||
    !isString(event.senderId) ||
    !Array.isArray(event.recipientIds) ||
    !event.recipientIds.every((recipient) => isString(recipient)) ||
    (event.text !== null && typeof event.text !== "string") ||
    !Array.isArray(event.attachments) ||
    typeof event.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(event.occurredAt))
  ) throw new ChannelError("INVALID_WEBHOOK", false);
  return event as ZaloBridgeEvent;
}

export class ZaloBridgeAdapter implements ChannelAdapter {
  readonly channelType = "ZALO" as const;
  readonly capabilities = new Set(["SEND_TEXT", "SEND_IMAGE", "SEND_FILE", "REPLY", "READ_RECEIPTS"] as const);

  constructor(
    private readonly workspaceId: string,
    private readonly channelAccountId: string,
    private readonly credential: ZaloBridgeCredential,
    private readonly transport: ChannelTransport,
    private readonly now: () => number = Date.now,
  ) {}

  async verifyWebhook(input: { headers: Readonly<Record<string, string>>; body: string }): Promise<VerifiedWebhook> {
    const timestamp = input.headers["x-hirex-timestamp"];
    const signature = input.headers["x-hirex-signature"];
    const timestampSeconds = Number(timestamp);
    if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Math.floor(this.now() / 1000) - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS || !signature) {
      throw new ChannelError("INVALID_WEBHOOK", false);
    }
    const expected = createHmac("sha256", this.credential.signingSecret).update(`${timestamp}.${input.body}`).digest("hex");
    if (!secureEqual(signature, expected)) throw new ChannelError("INVALID_WEBHOOK", false);
    let payload: unknown;
    try { payload = JSON.parse(input.body); } catch { throw new ChannelError("INVALID_WEBHOOK", false); }
    const event = parseEvent(payload);
    if (event.accountId !== this.credential.bridgeAccountId) throw new ChannelError("INVALID_WEBHOOK", false);
    return { channelAccountId: this.channelAccountId, providerEventId: event.eventId, receivedAt: new Date(this.now()).toISOString(), payload: event };
  }

  async normalizeInbound(input: VerifiedWebhook): Promise<CanonicalInboundMessage[]> {
    const event = parseEvent(input.payload);
    if (event.text === null && event.attachments.length === 0) return [];
    return [{
      workspaceId: this.workspaceId,
      channelAccountId: this.channelAccountId,
      channelType: "ZALO",
      providerConversationId: event.threadId,
      providerMessageId: event.messageId,
      providerEventId: event.eventId,
      sender: { contactId: null, channelType: "ZALO", externalId: event.senderId, displayName: null },
      recipients: event.recipientIds.map((externalId) => ({ contactId: null, channelType: "ZALO" as const, externalId, displayName: null })),
      text: event.text,
      attachments: event.attachments.map((attachment) => ({
        externalId: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        providerUrl: attachment.url,
      })),
      occurredAt: event.occurredAt,
      rawPayloadReference: null,
    }];
  }

  async sendMessage(command: SendMessageCommand): Promise<ChannelSendResult> {
    if (command.workspaceId !== this.workspaceId || command.channelAccountId !== this.channelAccountId || command.channelType !== "ZALO") {
      throw new ChannelError("ACCOUNT_UNAVAILABLE", false);
    }
    const body = JSON.stringify({
      accountId: this.credential.bridgeAccountId,
      recipientId: command.recipientExternalId,
      threadId: command.providerConversationId,
      text: command.text,
      attachments: command.attachments,
      idempotencyKey: command.idempotencyKey,
    });
    const timestamp = Math.floor(this.now() / 1000).toString();
    const signature = createHmac("sha256", this.credential.signingSecret).update(`${timestamp}.${body}`).digest("hex");
    const response = await this.transport.request({
      method: "POST",
      url: `${this.credential.bridgeBaseUrl.replace(/\/$/u, "")}/v1/messages/send`,
      headers: { "content-type": "application/json", "x-hirex-timestamp": timestamp, "x-hirex-signature": signature },
      body,
      timeoutMs: 15_000,
    });
    if (response.status === 401 || response.status === 403) throw new ChannelError("PERMISSION_DENIED", false);
    if (response.status === 429) throw new ChannelError("RATE_LIMITED", true);
    if (response.status < 200 || response.status >= 300) throw new ChannelError(response.status >= 500 ? "DELIVERY_UNKNOWN" : "DELIVERY_REJECTED", response.status >= 500);
    const result = response.body as { messageId?: unknown; threadId?: unknown };
    if (!isString(result?.messageId) || !isString(result?.threadId)) throw new ChannelError("DELIVERY_UNKNOWN", false);
    return { providerMessageId: result.messageId, providerConversationId: result.threadId, acceptedAt: new Date(this.now()).toISOString() };
  }

  async healthCheck(): Promise<"CONNECTED" | "REAUTH_REQUIRED" | "ERROR"> {
    const response = await this.transport.request({
      method: "GET",
      url: `${this.credential.bridgeBaseUrl.replace(/\/$/u, "")}/v1/accounts/${encodeURIComponent(this.credential.bridgeAccountId)}/health`,
      headers: {},
      timeoutMs: 10_000,
    });
    if (response.status === 401 || response.status === 403) return "REAUTH_REQUIRED";
    return response.status >= 200 && response.status < 300 ? "CONNECTED" : "ERROR";
  }
}
