import { createHash } from "node:crypto";

export function zaloContactIdentity(workspaceId: string, channelAccountId: string, senderId: string) {
  const uuid = (kind: string) => {
    const hex = createHash("sha256").update(`hirex:${kind}:${workspaceId}:${channelAccountId}:ZALO:${senderId}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  return { contactId: uuid("contact"), channelId: uuid("contact-channel") };
}

/** Reconfiguration never grants send, but preserves an operator-reviewed grant. */
export function zaloConnectCapabilities(input: {
  isExisting: boolean;
  existingCapabilities: unknown;
  providerAccountId: string;
  qaProviderAccountId: string | undefined;
}): string[] {
  const preserveReviewedSend = input.isExisting && Array.isArray(input.existingCapabilities) &&
    input.existingCapabilities.includes("SEND_TEXT");
  return preserveReviewedSend ? ["SEND_TEXT", "REPLY", "READ_RECEIPTS"] : ["READ_RECEIPTS"];
}
