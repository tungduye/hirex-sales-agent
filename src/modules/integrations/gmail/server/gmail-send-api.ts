import "server-only";

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const SEND_TIMEOUT_MS = 20_000;

export class GmailSendDefinitiveError extends Error {
  constructor(readonly safeCode:
    | "REAUTH_REQUIRED"
    | "GMAIL_PERMISSION_DENIED"
    | "GMAIL_RATE_LIMITED"
    | "GMAIL_SEND_REJECTED") {
    super("Gmail rejected the send request.");
  }
}

export class GmailSendAmbiguousError extends Error {
  constructor() {
    super("Gmail delivery status is unknown.");
  }
}

export async function sendRawGmailMessage(accessToken: string, raw: string) {
  let response: Response;
  try {
    response = await fetch(SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    throw new GmailSendAmbiguousError();
  }

  if (!response.ok) {
    if (response.status === 401) throw new GmailSendDefinitiveError("REAUTH_REQUIRED");
    if (response.status === 403) throw new GmailSendDefinitiveError("GMAIL_PERMISSION_DENIED");
    if (response.status === 429) throw new GmailSendDefinitiveError("GMAIL_RATE_LIMITED");
    if (response.status === 408 || response.status >= 500) throw new GmailSendAmbiguousError();
    throw new GmailSendDefinitiveError("GMAIL_SEND_REJECTED");
  }

  try {
    const body: unknown = await response.json();
    if (!isSendResponse(body)) throw new GmailSendAmbiguousError();
    return { providerMessageId: body.id, providerThreadId: body.threadId };
  } catch (error) {
    if (error instanceof GmailSendAmbiguousError) throw error;
    throw new GmailSendAmbiguousError();
  }
}

function isSendResponse(value: unknown): value is { id: string; threadId: string } {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return isProviderId(response.id) && isProviderId(response.threadId);
}

function isProviderId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && /^[a-zA-Z0-9_-]+$/.test(value);
}
