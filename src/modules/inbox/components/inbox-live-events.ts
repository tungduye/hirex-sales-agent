export const INBOX_MESSAGE_EVENT = "hirex:inbox-message";
export const INBOX_CONVERSATION_EVENT = "hirex:inbox-conversation";
export const INBOX_OPTIMISTIC_EVENT = "hirex:inbox-optimistic-message";
export const INBOX_OLDER_MESSAGES_EVENT = "hirex:inbox-older-messages";

export type RealtimeMessageRow = {
  id: string;
  conversation_id: string;
  channel_type: string;
  direction: "INBOUND" | "OUTBOUND";
  sender_external_id: string;
  text_content: string | null;
  provider_message_id: string;
  attachment_count: number;
  received_at: string | null;
  sent_at: string | null;
  created_at: string;
};

export type OptimisticMessage = {
  id: string;
  conversationId: string;
  text: string;
  timestamp: string;
  status: "SENDING" | "FAILED";
};

