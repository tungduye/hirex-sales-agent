export type ChannelErrorCode =
  | "INVALID_WEBHOOK"
  | "UNSUPPORTED_EVENT"
  | "ACCOUNT_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "DELIVERY_REJECTED"
  | "DELIVERY_UNKNOWN";

export class ChannelError extends Error {
  readonly code: ChannelErrorCode;
  readonly retryable: boolean;
  constructor(code: ChannelErrorCode, retryable: boolean) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.name = "ChannelError";
  }
}
