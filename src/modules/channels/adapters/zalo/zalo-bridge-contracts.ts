export interface ZaloBridgeCredential {
  bridgeBaseUrl: string;
  bridgeAccountId: string;
  signingSecret: string;
}

export interface ZaloBridgeEvent {
  eventId: string;
  accountId: string;
  threadId: string;
  messageId: string;
  senderId: string;
  senderName?: string | null;
  accountName?: string | null;
  recipientIds: string[];
  text: string | null;
  isSelf: boolean;
  attachments: Array<{
    id: string | null;
    filename: string | null;
    contentType: string | null;
    sizeBytes: number | null;
    url: string | null;
  }>;
  occurredAt: string;
}
