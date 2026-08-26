import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { encryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";
import { getGmailServerConfig } from "@/modules/integrations/gmail/server/config";
import {
  createGoogleOAuthClient,
  GMAIL_OAUTH_SCOPES,
  GMAIL_SEND_SCOPE,
} from "@/modules/integrations/gmail/server/oauth-client";
import {
  GMAIL_OAUTH_STATE_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE_PATH,
  shouldUseSecureOAuthCookie,
  verifyGmailOAuthState,
  type GmailOAuthPurpose,
} from "@/modules/integrations/gmail/server/oauth-state";
import { storeConnectedGmailAccount } from "@/modules/integrations/gmail/server/store-gmail-account";
import {
  upgradeGmailSendCredentials,
  verifyGmailSendUpgradeTarget,
} from "@/modules/integrations/gmail/server/upgrade-gmail-send-credentials";

export const runtime = "nodejs";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export async function GET(request: NextRequest) {
  const account = await getAccountContext();
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  clearStateCookie(cookieStore, request);

  if (!account) return NextResponse.redirect(new URL("/login", request.url));
  if (!account.workspaceId || !account.configurationComplete) return gmailErrorRedirect(request);

  const oauthState = verifyGmailOAuthState(
    stateCookie,
    request.nextUrl.searchParams.get("state"),
    account.userId,
    account.workspaceId,
  );
  if (!oauthState) return gmailErrorRedirect(request);

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    return oauthState.purpose === "ENABLE_SEND"
      ? sendFeedbackRedirect(request, oauthError === "access_denied" ? "send_denied" : "send_error")
      : gmailErrorRedirect(request);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return purposeErrorRedirect(request, oauthState.purpose);

  try {
    const oauthClient = createGoogleOAuthClient();
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.id_token) return purposeErrorRedirect(request, oauthState.purpose);

    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: getGmailServerConfig().googleClientId,
    });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email || identity.email_verified !== true) {
      return purposeErrorRedirect(request, oauthState.purpose);
    }

    const normalizedEmail = identity.email.trim().toLowerCase();
    if (!normalizedEmail) return purposeErrorRedirect(request, oauthState.purpose);

    if (oauthState.purpose === "ENABLE_SEND") {
      return completeSendUpgrade({
        request,
        oauthClient,
        oauthStateAccountId: oauthState.emailAccountId,
        workspaceId: account.workspaceId,
        providerAccountId: identity.sub,
        normalizedEmail,
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
      });
    }

    const grantedScopes = tokens.scope
      ? normalizeScopes(tokens.scope.split(/\s+/))
      : [...GMAIL_OAUTH_SCOPES];
    if (!grantedScopes.includes(GMAIL_READONLY_SCOPE)) return gmailErrorRedirect(request);

    const stored = await storeConnectedGmailAccount({
      workspaceId: account.workspaceId,
      connectedBy: account.userId,
      providerAccountId: identity.sub,
      emailAddress: normalizedEmail,
      displayName: identity.name?.trim() || null,
      refreshTokenEncrypted: tokens.refresh_token ? encryptCredential(tokens.refresh_token) : null,
      accessTokenEncrypted: tokens.access_token ? encryptCredential(tokens.access_token) : null,
      accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: grantedScopes,
    });

    return NextResponse.redirect(new URL(
      stored ? "/settings?gmail=connected" : "/settings?gmail=error",
      request.url,
    ));
  } catch {
    return purposeErrorRedirect(request, oauthState.purpose);
  }
}

async function completeSendUpgrade(input: {
  request: NextRequest;
  oauthClient: ReturnType<typeof createGoogleOAuthClient>;
  oauthStateAccountId: string | null;
  workspaceId: string;
  providerAccountId: string;
  normalizedEmail: string;
  accessToken: string | null;
  refreshToken: string | null;
}) {
  if (!input.oauthStateAccountId) return sendFeedbackRedirect(input.request, "send_error");

  const targetResult = await verifyGmailSendUpgradeTarget({
    emailAccountId: input.oauthStateAccountId,
    workspaceId: input.workspaceId,
    authorizedEmail: input.normalizedEmail,
    providerAccountId: input.providerAccountId,
  });
  if (targetResult === "ACCOUNT_MISMATCH") {
    return sendFeedbackRedirect(input.request, "send_account_mismatch");
  }
  if (targetResult === "TARGET_UNAVAILABLE") {
    return sendFeedbackRedirect(input.request, "send_error");
  }
  if (!input.accessToken) return sendFeedbackRedirect(input.request, "send_scope_missing");

  const tokenInfo = await input.oauthClient.getTokenInfo(input.accessToken);
  const scopes = normalizeScopes(tokenInfo.scopes);
  if (tokenInfo.aud !== getGmailServerConfig().googleClientId
    || (tokenInfo.sub && tokenInfo.sub !== input.providerAccountId)) {
    return sendFeedbackRedirect(input.request, "send_error");
  }
  if (!scopes.includes(GMAIL_READONLY_SCOPE) || !scopes.includes(GMAIL_SEND_SCOPE)) {
    return sendFeedbackRedirect(input.request, "send_scope_missing");
  }
  if (!Number.isFinite(tokenInfo.expiry_date) || tokenInfo.expiry_date <= Date.now()) {
    return sendFeedbackRedirect(input.request, "send_error");
  }

  const result = await upgradeGmailSendCredentials({
    emailAccountId: input.oauthStateAccountId,
    workspaceId: input.workspaceId,
    authorizedEmail: input.normalizedEmail,
    providerAccountId: input.providerAccountId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    accessTokenExpiresAt: new Date(tokenInfo.expiry_date).toISOString(),
    scopes,
  });

  if (result === "ACCOUNT_MISMATCH") {
    return sendFeedbackRedirect(input.request, "send_account_mismatch");
  }
  return sendFeedbackRedirect(
    input.request,
    result === "UPDATED" ? "send_enabled" : "send_error",
  );
}

function normalizeScopes(scopes: readonly string[]) {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
}

function clearStateCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  request: NextRequest,
) {
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureOAuthCookie(request.nextUrl),
    path: GMAIL_OAUTH_STATE_COOKIE_PATH,
    maxAge: 0,
  });
}

function purposeErrorRedirect(request: NextRequest, purpose: GmailOAuthPurpose) {
  return purpose === "ENABLE_SEND"
    ? sendFeedbackRedirect(request, "send_error")
    : gmailErrorRedirect(request);
}

function sendFeedbackRedirect(request: NextRequest, feedback: string) {
  return NextResponse.redirect(new URL(`/settings?gmail=${feedback}`, request.url));
}

function gmailErrorRedirect(request: NextRequest) {
  return NextResponse.redirect(new URL("/settings?gmail=error", request.url));
}
