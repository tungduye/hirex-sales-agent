import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createGoogleOAuthClient, GMAIL_OAUTH_SCOPES } from "@/modules/integrations/gmail/server/oauth-client";
import {
  createGmailOAuthState,
  GMAIL_OAUTH_STATE_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE_PATH,
  GMAIL_OAUTH_STATE_MAX_AGE_SECONDS,
  shouldUseSecureOAuthCookie,
} from "@/modules/integrations/gmail/server/oauth-state";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await getAccountContext();
  if (!account) return NextResponse.redirect(new URL("/login", request.url));
  if (!account.workspaceId || !account.configurationComplete) {
    return NextResponse.redirect(new URL("/settings?gmail=error", request.url));
  }

  try {
    const state = createGmailOAuthState(account.userId, account.workspaceId, "CONNECT");
    const cookieStore = await cookies();
    cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, state.cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureOAuthCookie(request.nextUrl),
      path: GMAIL_OAUTH_STATE_COOKIE_PATH,
      maxAge: GMAIL_OAUTH_STATE_MAX_AGE_SECONDS,
    });

    const authorizationUrl = createGoogleOAuthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: [...GMAIL_OAUTH_SCOPES],
      state: state.nonce,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch {
    return NextResponse.redirect(new URL("/settings?gmail=error", request.url));
  }
}
