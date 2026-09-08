export const CHANNEL_TYPES = [
  "EMAIL",
  "FACEBOOK",
  "ZALO",
  "WHATSAPP",
  "VIBER",
  "TELEGRAM",
  "OTHER",
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CHANNEL_ACCOUNT_STATUSES = [
  "CONNECTED",
  "REAUTH_REQUIRED",
  "DISCONNECTED",
  "ERROR",
] as const;

export type ChannelAccountStatus = (typeof CHANNEL_ACCOUNT_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const OUTBOUND_ACTION_STATUSES = [
  "PROPOSED",
  "APPROVED",
  "QUEUED",
  "EXECUTING",
  "SENT",
  "FAILED",
  "DELIVERY_UNKNOWN",
  "CANCELLED",
] as const;

export type OutboundActionStatus = (typeof OUTBOUND_ACTION_STATUSES)[number];

export type ChannelCapability =
  | "SEND_TEXT"
  | "SEND_IMAGE"
  | "SEND_FILE"
  | "REPLY"
  | "REACTIONS"
  | "DELIVERY_RECEIPTS"
  | "READ_RECEIPTS"
  | "TYPING_INDICATOR"
  | "TEMPLATES"
  | "COMMENTS";

export interface CanonicalParticipant {
  contactId: string | null;
  channelType: ChannelType;
  externalId: string;
  displayName: string | null;
}

export interface CanonicalAttachment {
  externalId: string | null;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  providerUrl: string | null;
}

export interface SendAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  contentBase64: string;
}

export interface CanonicalInboundMessage {
  workspaceId: string;
  channelAccountId: string;
  channelType: ChannelType;
  providerConversationId: string;
  providerMessageId: string;
  providerEventId: string | null;
  sender: CanonicalParticipant;
  recipients: CanonicalParticipant[];
  text: string | null;
  attachments: CanonicalAttachment[];
  occurredAt: string;
  rawPayloadReference: string | null;
}

export interface SendMessageCommand {
  actionId: string;
  workspaceId: string;
  channelAccountId: string;
  channelType: ChannelType;
  providerConversationId: string | null;
  recipientExternalId: string;
  text: string | null;
  attachments: SendAttachment[];
  idempotencyKey: string;
  policyDecisionId: string;
}

export interface ChannelSendResult {
  providerMessageId: string;
  providerConversationId: string;
  acceptedAt: string;
}

export interface VerifiedWebhook {
  channelAccountId: string;
  providerEventId: string | null;
  receivedAt: string;
  payload: unknown;
}

export interface ChannelAdapter {
  readonly channelType: ChannelType;
  readonly capabilities: ReadonlySet<ChannelCapability>;
  verifyWebhook(input: {
    headers: Readonly<Record<string, string>>;
    body: string;
  }): Promise<VerifiedWebhook>;
  normalizeInbound(input: VerifiedWebhook): Promise<CanonicalInboundMessage[]>;
  sendMessage(command: SendMessageCommand): Promise<ChannelSendResult>;
  healthCheck(channelAccountId: string): Promise<ChannelAccountStatus>;
}

export function isChannelType(value: unknown): value is ChannelType {
  return typeof value === "string" && CHANNEL_TYPES.includes(value as ChannelType);
}

export function hasSafeIdentifier(value: unknown, maximumLength = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

function isSendAttachment(value: unknown): value is SendAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<SendAttachment>;

  return (
    hasSafeIdentifier(attachment.id, 128) &&
    hasSafeIdentifier(attachment.filename, 255) &&
    hasSafeIdentifier(attachment.contentType, 255) &&
    Number.isSafeInteger(attachment.sizeBytes) && (attachment.sizeBytes ?? -1) >= 0 &&
    (attachment.sizeBytes ?? 0) <= 25 * 1024 * 1024 &&
    typeof attachment.sha256 === "string" && /^[0-9a-f]{64}$/u.test(attachment.sha256) &&
    typeof attachment.contentBase64 === "string" && attachment.contentBase64.length > 0 &&
    attachment.contentBase64.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*(?:={1,2})?$/u.test(attachment.contentBase64)
  );
}

export function isSendMessageCommand(value: unknown): value is SendMessageCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<SendMessageCommand>;

  return (
    hasSafeIdentifier(command.actionId, 128) &&
    hasSafeIdentifier(command.workspaceId, 128) &&
    hasSafeIdentifier(command.channelAccountId, 128) &&
    isChannelType(command.channelType) &&
    (command.providerConversationId === null ||
      hasSafeIdentifier(command.providerConversationId, 512)) &&
    hasSafeIdentifier(command.recipientExternalId, 512) &&
    (command.text === null ||
      (typeof command.text === "string" &&
        command.text.trim().length > 0 &&
        command.text.length <= 100_000 &&
        !command.text.includes("\u0000"))) &&
    Array.isArray(command.attachments) &&
    command.attachments.length <= 10 &&
    command.attachments.every(isSendAttachment) &&
    command.attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0) <= 25 * 1024 * 1024 &&
    (command.text !== null || command.attachments.length > 0) &&
    hasSafeIdentifier(command.idempotencyKey, 256) &&
    hasSafeIdentifier(command.policyDecisionId, 128)
  );
}
