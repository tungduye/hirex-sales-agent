import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { createGoogleOAuthClient, GMAIL_OAUTH_SCOPES } from "@/modules/integrations/gmail/server/oauth-client";
import { GMAIL_OAUTH_STATE_COOKIE, GMAIL_OAUTH_STATE_COOKIE_PATH } from "@/modules/integrations/gmail/server/oauth-state";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const account = await getAccountContext();
  if (!account) return NextResponse.redirect(new URL("/login", request.url));
  if (!account.workspaceId || !account.configurationComplete) {
    return NextResponse.redirect(new URL("/settings?gmail=error", request.url));
  }

  try {
    const state = randomBytes(32).toString("base64url");
    const cookieStore = await cookies();
    cookieStore.set(GMAIL_OAUTH_STATE_COOKIE, `${state}.${account.userId}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: GMAIL_OAUTH_STATE_COOKIE_PATH,
      maxAge: 10 * 60,
    });

    const authorizationUrl = createGoogleOAuthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: true,
      scope: [...GMAIL_OAUTH_SCOPES],
      state,
    });

    return NextResponse.redirect(authorizationUrl);
  } catch {
    return NextResponse.redirect(new URL("/settings?gmail=error", request.url));
  }
}
