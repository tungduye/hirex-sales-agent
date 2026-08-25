import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { encryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";
import { getGmailServerConfig } from "@/modules/integrations/gmail/server/config";
import { createGoogleOAuthClient, GMAIL_OAUTH_SCOPES } from "@/modules/integrations/gmail/server/oauth-client";
import { GMAIL_OAUTH_STATE_COOKIE, GMAIL_OAUTH_STATE_COOKIE_PATH } from "@/modules/integrations/gmail/server/oauth-state";
import { storeConnectedGmailAccount } from "@/modules/integrations/gmail/server/store-gmail-account";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await getAccountContext();
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value;
  clearStateCookie(cookieStore);

  if (!account) return NextResponse.redirect(new URL("/login", request.url));
  if (!account.workspaceId || !account.configurationComplete) return gmailErrorRedirect(request);

  const receivedState = request.nextUrl.searchParams.get("state");
  if (!statesMatch(expectedState, receivedState, account.userId)) return gmailErrorRedirect(request);
  if (request.nextUrl.searchParams.has("error")) return gmailErrorRedirect(request);

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return gmailErrorRedirect(request);

  try {
    const oauthClient = createGoogleOAuthClient();
    const { tokens } = await oauthClient.getToken(code);
    if (!tokens.id_token) return gmailErrorRedirect(request);

    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: getGmailServerConfig().googleClientId,
    });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email || identity.email_verified !== true) {
      return gmailErrorRedirect(request);
    }

    const normalizedEmail = identity.email.trim().toLowerCase();
    if (!normalizedEmail) return gmailErrorRedirect(request);

    const grantedScopes = tokens.scope
      ? tokens.scope.split(/\s+/).filter(Boolean)
      : [...GMAIL_OAUTH_SCOPES];
    if (!grantedScopes.includes("https://www.googleapis.com/auth/gmail.readonly")) {
      return gmailErrorRedirect(request);
    }

    const stored = await storeConnectedGmailAccount({
      workspaceId: account.workspaceId,
      connectedBy: account.userId,
      providerAccountId: identity.sub,
      emailAddress: normalizedEmail,
      displayName: identity.name?.trim() || null,
      refreshTokenEncrypted: tokens.refresh_token
        ? encryptCredential(tokens.refresh_token)
        : null,
      accessTokenEncrypted: tokens.access_token
        ? encryptCredential(tokens.access_token)
        : null,
      accessTokenExpiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      scopes: grantedScopes,
    });

    return NextResponse.redirect(new URL(
      stored ? "/settings?gmail=connected" : "/settings?gmail=error",
      request.url,
    ));
  } catch {
    return gmailErrorRedirect(request);
  }
}

function statesMatch(expectedCookie: string | undefined, received: string | null, userId: string) {
  if (!expectedCookie || !received) return false;
  const separatorIndex = expectedCookie.lastIndexOf(".");
  if (separatorIndex < 1) return false;

  const expected = expectedCookie.slice(0, separatorIndex);
  const expectedUserId = expectedCookie.slice(separatorIndex + 1);
  if (expectedUserId !== userId) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function clearStateCookie(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: GMAIL_OAUTH_STATE_COOKIE_PATH,
    maxAge: 0,
  });
}

function gmailErrorRedirect(request: NextRequest) {
  return NextResponse.redirect(new URL("/settings?gmail=error", request.url));
}
