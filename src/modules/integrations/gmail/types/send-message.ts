export type GmailSendSafeCode =
  | "SENT"
  | "SEND_SCOPE_REQUIRED"
  | "REAUTH_REQUIRED"
  | "INVALID_RECIPIENT"
  | "MIME_BUILD_FAILED"
  | "SEND_REQUEST_CONFLICT"
  | "SEND_IN_PROGRESS"
  | "GMAIL_PERMISSION_DENIED"
  | "GMAIL_RATE_LIMITED"
  | "GMAIL_SEND_REJECTED"
  | "GMAIL_TEMPORARY_ERROR"
  | "DELIVERY_STATUS_UNKNOWN";

export interface GmailSendResult {
  success: boolean;
  code: GmailSendSafeCode;
  message: string;
  sendRequestId: string | null;
}
