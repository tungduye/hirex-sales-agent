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
import type { ChannelHttpResponse, ChannelTransport } from "../../core/channel-transport";
import type { ZaloBridgeCredential, ZaloBridgeEvent } from "./zalo-bridge-contracts";
import type { ProviderHealthStatus } from "../../core/provider-health";
import { signZaloBridgeRequest } from "./zalo-bridge-signing";
import { requireTrustedZaloBridgeOrigin } from "./trusted-bridge-origin";

const MAX_CLOCK_SKEW_SECONDS = 300;
const SEND_PATH="/v1/messages/send";
const RECONCILE_PATH="/v1/deliveries/reconcile";
const FIND_BY_PHONE_PATH="/v1/zalo/users/find-by-phone";
const FRIEND_REQUEST_PATH="/v1/zalo/friend-requests/send";
const REACT_PATH="/v1/messages/react";
const GROUP_NOTE_PATH="/v1/groups/notes";
const SEND_TIMEOUT_MS=20_000;
// A file is downloaded by the bridge and uploaded to Zalo before it answers (the bridge itself gives up after 75 s).
const FILE_SEND_TIMEOUT_MS=85_000;

export type ZaloWebhookDiagnosticCode =
  | "TIMESTAMP_INVALID"
  | "SIGNATURE_INVALID"
  | "JSON_INVALID"
  | "SCHEMA_INVALID"
  | "PROVIDER_ACCOUNT_MISMATCH";

export class ZaloWebhookDiagnosticError extends ChannelError {
  readonly diagnosticCode: ZaloWebhookDiagnosticCode;
  constructor(diagnosticCode: ZaloWebhookDiagnosticCode) {
    super("INVALID_WEBHOOK", false);
    this.diagnosticCode = diagnosticCode;
    this.name = "ZaloWebhookDiagnosticError";
  }
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function isString(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function isOptionalName(value: unknown): value is string | null | undefined {
  return value === undefined || value === null ||
    (typeof value === "string" && value.trim().length > 0 && value.length <= 255 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
}

function isAttachment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Record<string, unknown>;
  return (attachment.id === null || isString(attachment.id)) &&
    (attachment.filename === null || isString(attachment.filename, 255)) &&
    (attachment.contentType === null || typeof attachment.contentType === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(attachment.contentType)) &&
    (attachment.sizeBytes === null || Number.isSafeInteger(attachment.sizeBytes) && Number(attachment.sizeBytes) >= 0 && Number(attachment.sizeBytes) <= 100_000_000) &&
    attachment.url === null;
}

function parseEvent(value: unknown): ZaloBridgeEvent {
  if (!value || typeof value !== "object") throw new ZaloWebhookDiagnosticError("SCHEMA_INVALID");
  const event = value as Partial<ZaloBridgeEvent>;
  if (
    !isString(event.eventId) ||
    !isString(event.accountId) ||
    !isString(event.threadId) ||
    !isString(event.messageId) ||
    !isString(event.senderId) ||
    !isOptionalName(event.senderName) ||
    !isOptionalName(event.accountName) ||
    !Array.isArray(event.recipientIds) ||
    !event.recipientIds.every((recipient) => isString(recipient)) ||
    (event.text !== null && typeof event.text !== "string") ||
    typeof event.isSelf !== "boolean" ||
    !Array.isArray(event.attachments) ||
    event.attachments.length > 20 ||
    !event.attachments.every(isAttachment) ||
    typeof event.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    (event.isSelf
      ? event.senderId !== event.accountId || event.recipientIds.length !== 1 || event.recipientIds[0] === event.accountId
      : event.senderId === event.accountId || !event.recipientIds.includes(event.accountId))
  ) throw new ZaloWebhookDiagnosticError("SCHEMA_INVALID");
  return event as ZaloBridgeEvent;
}

export class ZaloBridgeAdapter implements ChannelAdapter {
  readonly channelType = "ZALO" as const;
  readonly capabilities = new Set(["SEND_TEXT", "SEND_IMAGE", "SEND_FILE", "REPLY", "READ_RECEIPTS"] as const);
  private readonly workspaceId:string;private readonly channelAccountId:string;private readonly credential:ZaloBridgeCredential;private readonly transport:ChannelTransport;private readonly now:()=>number;

  constructor(
    workspaceId: string, channelAccountId: string, credential: ZaloBridgeCredential, transport: ChannelTransport, now: () => number = Date.now,
  ) {this.workspaceId=workspaceId;this.channelAccountId=channelAccountId;this.credential={...credential,bridgeBaseUrl:requireTrustedZaloBridgeOrigin(credential.bridgeBaseUrl)};this.transport=transport;this.now=now;}

  async verifyWebhook(input: { headers: Readonly<Record<string, string>>; body: string }): Promise<VerifiedWebhook> {
    const timestamp = input.headers["x-hirex-timestamp"];
    const signature = input.headers["x-hirex-signature"];
    const timestampSeconds = Number(timestamp);
    if (!Number.isSafeInteger(timestampSeconds) || Math.abs(Math.floor(this.now() / 1000) - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS || !signature) {
      throw new ZaloWebhookDiagnosticError("TIMESTAMP_INVALID");
    }
    const expected = createHmac("sha256", this.credential.signingSecret).update(`${timestamp}.${input.body}`).digest("hex");
    if (!secureEqual(signature, expected)) throw new ZaloWebhookDiagnosticError("SIGNATURE_INVALID");
    let payload: unknown;
    try { payload = JSON.parse(input.body); } catch { throw new ZaloWebhookDiagnosticError("JSON_INVALID"); }
    const event = parseEvent(payload);
    if (event.accountId !== this.credential.bridgeAccountId) throw new ZaloWebhookDiagnosticError("PROVIDER_ACCOUNT_MISMATCH");
    return { channelAccountId: this.channelAccountId, providerEventId: event.eventId, receivedAt: new Date(this.now()).toISOString(), payload: event };
  }

  async normalizeInbound(input: VerifiedWebhook): Promise<CanonicalInboundMessage[]> {
    const event = parseEvent(input.payload);
    if (event.text === null && event.attachments.length === 0) return [];
    return [{
      workspaceId: this.workspaceId,
      channelAccountId: this.channelAccountId,
      channelType: "ZALO",
      accountDisplayName: event.accountName?.trim() || null,
      providerConversationId: event.threadId,
      providerMessageId: event.messageId,
      providerEventId: event.eventId,
      direction: event.isSelf ? "OUTBOUND" : "INBOUND",
      sender: { contactId: null, channelType: "ZALO", externalId: event.senderId, displayName: event.senderName?.trim() || null },
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
    if (typeof command.conversationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(command.conversationId))
      throw new ChannelError("DELIVERY_REJECTED", false);
    // A group chat is sent to the group itself, and only as a person's reply or as the Zalo Trợ lý
    // answering a staff member who called it there (key made only by propose_assistant_bot_message_service).
    // Anything else (for example an old pending action addressed to one member) is refused before reaching Zalo.
    const group = command.threadKind === "GROUP";
    // Also a group broadcast approved by a member (key made only by propose_zalo_broadcast_send_service).
    const assistantReply = command.source === "AI_AUTOMATION" && (command.idempotencyKey.startsWith("assistant-bot:") || command.idempotencyKey.startsWith("group-broadcast:"));
    if (group && ((command.source !== "HUMAN_MANUAL" && !assistantReply) || !command.providerConversationId || command.recipientExternalId !== command.providerConversationId))
      throw new ChannelError("DELIVERY_REJECTED", false);
    // A person's reply, or a Word file the Trợ lý made, may be one stored file, sent on its own (no text, tags or quote).
    const file = command.attachments[0];
    if (command.attachments.length > 1 || (file && ((command.source !== "HUMAN_MANUAL" && !assistantReply) || command.text !== null || command.mentions?.length ||
        command.quoteMessageId || typeof file.signedUrl !== "string")))
      throw new ChannelError("DELIVERY_REJECTED", false);
    const body = JSON.stringify({
      workspaceId: command.workspaceId,
      connectedAccountId: command.channelAccountId,
      conversationId: command.conversationId,
      actionId: command.actionId,
      accountId: this.credential.bridgeAccountId,
      recipientId: command.recipientExternalId,
      threadId: command.providerConversationId,
      ...(group ? { threadType: "GROUP", ...(command.mentions?.length ? { mentions: command.mentions } : {}) } : {}),
      ...(command.quoteMessageId && command.source === "HUMAN_MANUAL" ? { quoteMessageId: command.quoteMessageId } : {}),
      text: command.text,
      attachments: file ? [{ id: file.id, filename: file.filename, contentType: file.contentType, sizeBytes: file.sizeBytes, sha256: file.sha256, url: file.signedUrl }] : [],
      idempotencyKey: command.idempotencyKey,
      source: command.source,
    });
    const timestamp = Math.floor(this.now() / 1000).toString();
    const signature = signZaloBridgeRequest(this.credential.signingSecret,{method:"POST",path:SEND_PATH,timestamp,body,idempotencyKey:command.idempotencyKey});
    const response = await this.transport.request({
      method: "POST",
      url: `${this.credential.bridgeBaseUrl.replace(/\/$/u, "")}${SEND_PATH}`,
      headers: { "content-type": "application/json", "x-hirex-timestamp": timestamp, "x-hirex-signature": signature, "x-hirex-idempotency-key":command.idempotencyKey },
      body,
      timeoutMs: file ? FILE_SEND_TIMEOUT_MS : SEND_TIMEOUT_MS,
    });
    const result = response.body as { status?: unknown; messageId?: unknown; threadId?: unknown; errorCode?: unknown };
    if (response.status === 409 && result?.status === "BLOCKED" && result.errorCode === "ACCOUNT_BUSY") throw new ChannelError("ACCOUNT_BUSY", false);
    if (response.status === 401 || response.status === 403) throw new ChannelError("PERMISSION_DENIED", false);
    if (response.status === 429) throw new ChannelError("RATE_LIMITED", true);
    if (response.status < 200 || response.status >= 300) throw new ChannelError(response.status >= 500 ? "DELIVERY_UNKNOWN" : "DELIVERY_REJECTED", response.status >= 500);
    if(result?.status==="FAILED")throw new ChannelError("DELIVERY_REJECTED",false);
    if(result?.status==="UNKNOWN")throw new ChannelError("DELIVERY_UNKNOWN",false);
    if (result?.status!=="SENT"||!isString(result.messageId)||!isString(result.threadId)) throw new ChannelError("DELIVERY_UNKNOWN", false);
    return { providerMessageId: result.messageId, providerConversationId: result.threadId, acceptedAt: new Date(this.now()).toISOString() };
  }

  async acknowledgeUnknownNoRetry(idempotencyKey: string): Promise<boolean> {
    if (!isString(idempotencyKey, 512)) return false;
    const body = JSON.stringify({ idempotencyKey, decision: "ACKNOWLEDGE_NO_RETRY" });
    const timestamp = Math.floor(this.now() / 1000).toString();
    const response = await this.transport.request({
      method: "POST", url: `${this.credential.bridgeBaseUrl.replace(/\/$/u, "")}${RECONCILE_PATH}`,
      headers: { "content-type": "application/json", "x-hirex-timestamp": timestamp,
        "x-hirex-signature": signZaloBridgeRequest(this.credential.signingSecret,{method:"POST",path:RECONCILE_PATH,timestamp,body,idempotencyKey}),
        "x-hirex-idempotency-key": idempotencyKey },
      body, timeoutMs: 10_000,
    });
    return response.status === 200 && Boolean(response.body) && typeof response.body === "object" &&
      (response.body as { status?: unknown }).status === "ACKNOWLEDGED_NO_RETRY";
  }

  private async contactRequest(path: string, payload: Record<string, unknown>, idempotencyKey: string, source: "HUMAN_MANUAL" | "AI_AUTOMATION" = "HUMAN_MANUAL") {
    const body = JSON.stringify({ accountId: this.credential.bridgeAccountId, ...payload, idempotencyKey, source });
    const timestamp = Math.floor(this.now() / 1000).toString();
    let response: ChannelHttpResponse;
    try {
      response = await this.transport.request({ method: "POST", url: `${this.credential.bridgeBaseUrl.replace(/\/$/u, "")}${path}`,
        headers: { "content-type": "application/json", "x-hirex-timestamp": timestamp,
          "x-hirex-signature": signZaloBridgeRequest(this.credential.signingSecret, { method: "POST", path, timestamp, body, idempotencyKey }),
          "x-hirex-idempotency-key": idempotencyKey }, body, timeoutMs: 15_000 });
    } catch {
      throw new ChannelError("ACCOUNT_UNAVAILABLE", true);
    }
    if (response.status === 401 || response.status === 403) throw new ChannelError("PERMISSION_DENIED", false);
    if (response.status === 429) throw new ChannelError("RATE_LIMITED", true);
    if (response.status === 409 && response.body && typeof response.body === "object" &&
      (response.body as { status?: unknown; errorCode?: unknown }).status === "BLOCKED" &&
      (response.body as { errorCode?: unknown }).errorCode === "ACCOUNT_BUSY") throw new ChannelError("ACCOUNT_BUSY", true);
    if (response.status < 200 || response.status >= 300 || !response.body || typeof response.body !== "object")
      throw new ChannelError("ACCOUNT_UNAVAILABLE", response.status >= 500);
    return response.body as Record<string, unknown>;
  }

  async findUserByPhone(phone: string, idempotencyKey: string) {
    if (!/^\+84[1-9][0-9]{8,9}$/u.test(phone) || !isString(idempotencyKey)) throw new ChannelError("DELIVERY_REJECTED", false);
    const result = await this.contactRequest(FIND_BY_PHONE_PATH, { phone }, idempotencyKey);
    if (result.status === "NOT_FOUND") return null;
    if (result.status === "BLOCKED" && result.errorCode === "ACCOUNT_BUSY") throw new ChannelError("ACCOUNT_BUSY", true);
    if (result.status === "FAILED" && result.errorCode === "RATE_LIMITED") throw new ChannelError("RATE_LIMITED", true);
    if (result.status === "FAILED" && result.errorCode === "ACCOUNT_UNAVAILABLE") throw new ChannelError("ACCOUNT_UNAVAILABLE", true);
    if (result.status !== "FOUND" || !isString(result.userId) || !isString(result.displayName, 255) ||
      !(result.avatarUrl === null || typeof result.avatarUrl === "string") || typeof result.isFriend !== "boolean")
      throw new ChannelError("ACCOUNT_UNAVAILABLE", false);
    return { userId: result.userId, displayName: result.displayName, avatarUrl: result.avatarUrl as string | null, isFriend: result.isFriend };
  }

  /** A person's quick reaction (HEART, LIKE, ...) to one message of this nick's chat. True when Zalo took it. */
  async addReaction(input: { threadId: string; threadType: "USER" | "GROUP"; messageId: string; icon: string }, idempotencyKey: string) {
    if (!isString(input.threadId, 512) || !/^[1-9][0-9]{0,39}$/u.test(input.messageId) || !isString(idempotencyKey)) throw new ChannelError("DELIVERY_REJECTED", false);
    const result = await this.contactRequest(REACT_PATH, { threadId: input.threadId, threadType: input.threadType, messageId: input.messageId, icon: input.icon }, idempotencyKey);
    return result.status === "REACTED";
  }

  /**
   * Top of a group this nick is in, for an approved group broadcast: a pinned note ("Ghi chú", kind NOTE) or
   * the broadcast message this nick sent, pinned ("Tin ghim", kind MESSAGE with its Zalo msg id).
   */
  async pinGroupNote(input: { groupId: string; kind: "NOTE" | "MESSAGE"; text: string; messageId: string | null }, idempotencyKey: string) {
    if (!isString(input.groupId, 512) || !input.text.trim() || input.text.length > (input.kind === "NOTE" ? 2000 : 4000) ||
        (input.kind === "MESSAGE" ? !/^[1-9][0-9]{0,39}$/u.test(input.messageId ?? "") : input.messageId !== null) ||
        !/^group-broadcast:[0-9a-f-]{36}:(?:pin|note):[1-3]$/u.test(idempotencyKey))
      throw new ChannelError("DELIVERY_REJECTED", false);
    const result = await this.contactRequest(GROUP_NOTE_PATH, { groupId: input.groupId, kind: input.kind, text: input.text, messageId: input.messageId }, idempotencyKey, "AI_AUTOMATION");
    return result.status === "PINNED";
  }

  async sendFriendRequest(userId: string, message: string, idempotencyKey: string) {
    if (!isString(userId) || message.length > 150 || !isString(idempotencyKey)) throw new ChannelError("DELIVERY_REJECTED", false);
    const result = await this.contactRequest(FRIEND_REQUEST_PATH, { userId, message, confirmed: true }, idempotencyKey);
    if (!["SENT", "ALREADY_FRIEND", "ALREADY_PENDING"].includes(String(result.status))) throw new ChannelError("DELIVERY_REJECTED", false);
    return result.status as "SENT" | "ALREADY_FRIEND" | "ALREADY_PENDING";
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    try { const path=`/v1/accounts/${encodeURIComponent(this.credential.bridgeAccountId)}/health`,timestamp=Math.floor(this.now()/1000).toString(),body="",idempotencyKey="";
    const response = await this.transport.request({
      method: "GET",
      url: `${this.credential.bridgeBaseUrl.replace(/\/$/u, "")}${path}`,
      headers: {"x-hirex-timestamp":timestamp,"x-hirex-signature":signZaloBridgeRequest(this.credential.signingSecret,{method:"GET",path,timestamp,body,idempotencyKey})},
      timeoutMs: 10_000,
    });
    if (response.status === 401 || response.status === 403) return "AUTH_REQUIRED";
    if(response.status<200||response.status>=300||!response.body||typeof response.body!=="object")return "UNKNOWN";
    const status=(response.body as {status?:unknown}).status;
    return ["HEALTHY","DEGRADED","DISCONNECTED","AUTH_REQUIRED","UNKNOWN"].includes(String(status))?status as ProviderHealthStatus:"UNKNOWN";
    } catch{return "UNKNOWN";}
  }
}
