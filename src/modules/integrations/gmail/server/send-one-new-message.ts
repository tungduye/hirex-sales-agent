import "server-only";

import { randomUUID } from "node:crypto";
import { GMAIL_SEND_SCOPE } from "@/modules/integrations/gmail/server/oauth-client";
import {
  claimSendRequest,
  createOrLoadSendRequest,
  finalizeSendRequestFailed,
  finalizeSendRequestSent,
  loadSendAccount,
  loadSendRequestById,
  payloadMatches,
  type EmailSendRequestRow,
} from "@/modules/integrations/gmail/server/email-send-request-store";
import {
  GmailSendAmbiguousError,
  GmailSendDefinitiveError,
  sendRawGmailMessage,
} from "@/modules/integrations/gmail/server/gmail-send-api";
import { buildPlainTextGmailMessage } from "@/modules/integrations/gmail/server/gmail-send-mime";
import {
  GmailSendCredentialError,
  loadGmailSendCredentials,
} from "@/modules/integrations/gmail/server/send-credentials";
import { markReauthenticationRequired } from "@/modules/integrations/gmail/server/sync-credentials";
import type { SendNewMessageInput } from "@/modules/integrations/gmail/schemas/send-new-message";
import type { GmailSendResult, GmailSendSafeCode } from "@/modules/integrations/gmail/types/send-message";

export async function sendOneNewGmailMessage(
  input: SendNewMessageInput,
  workspaceId: string,
): Promise<GmailSendResult> {
  const account = await loadSendAccount(input.emailAccountId, workspaceId);
  if (!account) return result(false, "GMAIL_SEND_REJECTED", null);
  if (!account.scopes.includes(GMAIL_SEND_SCOPE)) {
    return result(false, "SEND_SCOPE_REQUIRED", null);
  }

  const senderDomain = getMessageIdDomain(account.emailAddress);
  if (!senderDomain) return result(false, "MIME_BUILD_FAILED", null);

  const stored = await createOrLoadSendRequest(input, workspaceId, senderDomain);
  if (!stored) return result(false, "GMAIL_TEMPORARY_ERROR", null);
  const request = stored.row;
  if (!payloadMatches(request, input)) {
    return result(false, "SEND_REQUEST_CONFLICT", request.id);
  }

  const existingResult = resultForExistingRequest(request);
  if (existingResult) return existingResult;

  const lockId = randomUUID();
  const claimed = await claimSendRequest(request.id, workspaceId, input.emailAccountId, lockId);
  if (!claimed) {
    const current = await loadSendRequestById(request.id, workspaceId, input.emailAccountId);
    return current
      ? resultForExistingRequest(current) ?? result(false, "SEND_IN_PROGRESS", current.id)
      : result(false, "DELIVERY_STATUS_UNKNOWN", request.id);
  }

  let raw: string;
  try {
    if (!request.rfc_message_id) throw new Error("RFC_MESSAGE_ID_MISSING");
    raw = buildPlainTextGmailMessage({
      from: account.emailAddress,
      to: input.to,
      subject: input.subject,
      bodyText: input.bodyText,
      rfcMessageId: request.rfc_message_id,
      sendRequestId: request.id,
    });
  } catch {
    return finalizeDefinitiveFailure(
      request.id,
      workspaceId,
      input.emailAccountId,
      lockId,
      "MIME_BUILD_FAILED",
    );
  }

  let accessToken: string;
  try {
    const credential = await loadGmailSendCredentials(input.emailAccountId, workspaceId);
    accessToken = credential.accessToken;
  } catch (error) {
    const code = error instanceof GmailSendCredentialError
      ? error.safeCode
      : "GMAIL_TEMPORARY_ERROR";
    return finalizeDefinitiveFailure(
      request.id,
      workspaceId,
      input.emailAccountId,
      lockId,
      code,
    );
  }

  try {
    const providerResult = await sendRawGmailMessage(accessToken, raw);
    const finalized = await finalizeSendRequestSent({
      requestId: request.id,
      workspaceId,
      emailAccountId: input.emailAccountId,
      lockId,
      providerMessageId: providerResult.providerMessageId,
      providerThreadId: providerResult.providerThreadId,
    });
    return finalized
      ? result(true, "SENT", request.id)
      : result(false, "DELIVERY_STATUS_UNKNOWN", request.id);
  } catch (error) {
    if (error instanceof GmailSendAmbiguousError) {
      return result(false, "DELIVERY_STATUS_UNKNOWN", request.id);
    }
    if (error instanceof GmailSendDefinitiveError) {
      if (error.safeCode === "REAUTH_REQUIRED") {
        await markReauthenticationRequired(input.emailAccountId, workspaceId);
      }
      return finalizeDefinitiveFailure(
        request.id,
        workspaceId,
        input.emailAccountId,
        lockId,
        error.safeCode,
      );
    }
    return result(false, "DELIVERY_STATUS_UNKNOWN", request.id);
  }
}

async function finalizeDefinitiveFailure(
  requestId: string,
  workspaceId: string,
  emailAccountId: string,
  lockId: string,
  safeErrorCode: Exclude<GmailSendSafeCode,
    "SENT" | "SEND_REQUEST_CONFLICT" | "SEND_IN_PROGRESS" | "DELIVERY_STATUS_UNKNOWN">,
) {
  const finalized = await finalizeSendRequestFailed({
    requestId,
    workspaceId,
    emailAccountId,
    lockId,
    safeErrorCode,
  });
  return finalized
    ? result(false, safeErrorCode, requestId)
    : result(false, "DELIVERY_STATUS_UNKNOWN", requestId);
}

function resultForExistingRequest(request: EmailSendRequestRow): GmailSendResult | null {
  if (request.status === "SENT") return result(true, "SENT", request.id);
  if (request.status === "SENDING") return result(false, "DELIVERY_STATUS_UNKNOWN", request.id);
  if (request.status === "FAILED") {
    return result(false, toKnownFailureCode(request.safe_error_code), request.id);
  }
  if (request.status === "CANCELLED") return result(false, "GMAIL_SEND_REJECTED", request.id);
  return null;
}

function toKnownFailureCode(value: string | null): GmailSendSafeCode {
  const known: GmailSendSafeCode[] = [
    "SEND_SCOPE_REQUIRED",
    "REAUTH_REQUIRED",
    "INVALID_RECIPIENT",
    "MIME_BUILD_FAILED",
    "GMAIL_PERMISSION_DENIED",
    "GMAIL_RATE_LIMITED",
    "GMAIL_SEND_REJECTED",
    "GMAIL_TEMPORARY_ERROR",
  ];
  return value && known.includes(value as GmailSendSafeCode)
    ? value as GmailSendSafeCode
    : "GMAIL_SEND_REJECTED";
}

function getMessageIdDomain(emailAddress: string) {
  if (/[\r\n]/.test(emailAddress)) return null;
  const separator = emailAddress.lastIndexOf("@");
  if (separator < 1) return null;
  const localPart = emailAddress.slice(0, separator);
  if (emailAddress.length > 254
    || localPart.length > 64
    || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)) return null;
  const domain = emailAddress.slice(separator + 1).trim().toLowerCase();
  if (domain.length < 1 || domain.length > 253) return null;
  const labels = domain.split(".");
  return labels.every((label) => label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    ? domain
    : null;
}

function result(
  success: boolean,
  code: GmailSendSafeCode,
  sendRequestId: string | null,
): GmailSendResult {
  return { success, code, sendRequestId, message: safeMessage(code) };
}

function safeMessage(code: GmailSendSafeCode) {
  switch (code) {
    case "SENT": return "Gmail accepted the message.";
    case "SEND_SCOPE_REQUIRED": return "Enable Gmail sending for this account first.";
    case "REAUTH_REQUIRED": return "Gmail access expired. Reconnect the account and try again.";
    case "INVALID_RECIPIENT": return "Enter one valid recipient email address.";
    case "SEND_REQUEST_CONFLICT": return "This send attempt was already used for different content.";
    case "SEND_IN_PROGRESS":
    case "DELIVERY_STATUS_UNKNOWN": return "Delivery status is unknown. Do not resend this message.";
    case "GMAIL_RATE_LIMITED": return "Gmail rate-limited this request. This attempt will not retry automatically.";
    case "GMAIL_PERMISSION_DENIED": return "Gmail did not permit this send. Readonly sync remains connected.";
    case "MIME_BUILD_FAILED": return "The message could not be prepared safely.";
    default: return "The message was not sent. This attempt will not retry automatically.";
  }
}
