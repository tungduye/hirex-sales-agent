import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getGmailServerConfig } from "@/modules/integrations/gmail/server/config";

export const GMAIL_OAUTH_STATE_COOKIE = "hirex_gmail_oauth_state";
export const GMAIL_OAUTH_STATE_COOKIE_PATH = "/api/integrations/gmail/callback";
export const GMAIL_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export type GmailOAuthPurpose = "CONNECT" | "ENABLE_SEND";

export interface GmailOAuthState {
  nonce: string;
  userId: string;
  workspaceId: string;
  purpose: GmailOAuthPurpose;
  emailAccountId: string | null;
  expiresAt: number;
}

export function createGmailOAuthState(
  userId: string,
  workspaceId: string,
  purpose: "CONNECT",
): { nonce: string; cookieValue: string };
export function createGmailOAuthState(
  userId: string,
  workspaceId: string,
  purpose: "ENABLE_SEND",
  emailAccountId: string,
): { nonce: string; cookieValue: string };
export function createGmailOAuthState(
  userId: string,
  workspaceId: string,
  purpose: GmailOAuthPurpose,
  emailAccountId: string | null = null,
) {
  if (!userId || !workspaceId) throw new Error("OAuth state context is incomplete.");
  if ((purpose === "CONNECT" && emailAccountId !== null)
    || (purpose === "ENABLE_SEND" && !emailAccountId)) {
    throw new Error("OAuth state account binding is invalid.");
  }
  const state: GmailOAuthState = {
    nonce: randomBytes(32).toString("base64url"),
    userId,
    workspaceId,
    purpose,
    emailAccountId,
    expiresAt: Date.now() + GMAIL_OAUTH_STATE_MAX_AGE_SECONDS * 1000,
  };
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  return { nonce: state.nonce, cookieValue: `${payload}.${sign(payload)}` };
}

export function verifyGmailOAuthState(
  cookieValue: string | undefined,
  receivedNonce: string | null,
  currentUserId: string,
  currentWorkspaceId: string,
): GmailOAuthState | null {
  if (!cookieValue || !receivedNonce) return null;
  const separatorIndex = cookieValue.lastIndexOf(".");
  if (separatorIndex < 1) return null;

  const payload = cookieValue.slice(0, separatorIndex);
  const receivedSignature = cookieValue.slice(separatorIndex + 1);
  if (!safeEqual(sign(payload), receivedSignature)) return null;

  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!isGmailOAuthState(value)) return null;
    if (value.userId !== currentUserId
      || value.workspaceId !== currentWorkspaceId
      || value.expiresAt <= Date.now()) return null;
    if (!safeEqual(value.nonce, receivedNonce)) return null;
    if (value.purpose === "CONNECT" && value.emailAccountId !== null) return null;
    if (value.purpose === "ENABLE_SEND" && !value.emailAccountId) return null;
    return value;
  } catch {
    return null;
  }
}

function sign(payload: string) {
  return createHmac("sha256", getGmailServerConfig().encryptionKey)
    .update(payload)
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function isGmailOAuthState(value: unknown): value is GmailOAuthState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return typeof state.nonce === "string" && state.nonce.length > 0
    && typeof state.userId === "string" && state.userId.length > 0
    && typeof state.workspaceId === "string" && state.workspaceId.length > 0
    && (state.purpose === "CONNECT" || state.purpose === "ENABLE_SEND")
    && (state.emailAccountId === null
      || (typeof state.emailAccountId === "string" && state.emailAccountId.length > 0))
    && typeof state.expiresAt === "number"
    && Number.isFinite(state.expiresAt);
}

export function shouldUseSecureOAuthCookie(requestUrl: URL) {
  if (requestUrl.protocol === "https:") return true;
  return !(requestUrl.protocol === "http:" && isLoopbackHostname(requestUrl.hostname));
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1";
}
