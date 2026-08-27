export type SendReconciliationClassification = "SAFE_MATCH" | "NO_MATCH" | "AMBIGUOUS";

export type SendReconciliationReason =
  | "SAFE_EXACT_CANONICAL_MATCH"
  | "REQUEST_NOT_ELIGIBLE"
  | "CORRELATION_NOT_FOUND"
  | "MULTIPLE_CORRELATION_MATCHES"
  | "SENT_LABEL_MISSING"
  | "SPAM_OR_TRASH_MESSAGE"
  | "SENDER_MISMATCH"
  | "RECIPIENT_MISMATCH"
  | "SUBJECT_MISMATCH"
  | "BODY_MISMATCH"
  | "BODY_COMPARISON_UNCERTAIN"
  | "PROVIDER_MESSAGE_ID_CONFLICT"
  | "PROVIDER_THREAD_ID_CONFLICT"
  | "UNSUPPORTED_REQUEST_SHAPE"
  | "CANONICAL_THREAD_UNAVAILABLE"
  | "EVALUATION_UNAVAILABLE";

export interface SendReconciliationResult {
  classification: SendReconciliationClassification;
  reason: SendReconciliationReason;
  sendRequestId: string;
  matchedEmailMessageId: string | null;
}
