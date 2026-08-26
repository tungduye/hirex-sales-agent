import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import {
  createGoogleOAuthClient,
  GMAIL_SEND_SCOPE,
  GMAIL_SEND_UPGRADE_SCOPES,
} from "@/modules/integrations/gmail/server/oauth-client";
import {
  createGmailOAuthState,
  GMAIL_OAUTH_STATE_COOKIE,
  GMAIL_OAUTH_STATE_COOKIE_PATH,
  GMAIL_OAUTH_STATE_MAX_AGE_SECONDS,
  shouldUseSecureOAuthCookie,
} from "@/modules/integrations/gmail/server/oauth-state";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

export const runtime = "nodejs";

interface EmailAccountRow {
  id: string;
  scopes: string[];
}

export async function GET(request: NextRequest) {
  const account = await getAccountContext();
  if (!account) return NextResponse.redirect(new URL("/login", request.url));
  if (!account.workspaceId || !account.configurationComplete) {
    return sendFeedbackRedirect(request, "send_error");
  }

  const emailAccountId = request.nextUrl.searchParams.get("account")?.trim();
  if (!emailAccountId) return sendFeedbackRedirect(request, "send_error");

  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, scopes")
    .eq("id", emailAccountId)
    .eq("workspace_id", account.workspaceId)
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .maybeSingle();
  const target = data as EmailAccountRow | null;

  if (error || !target) return sendFeedbackRedirect(request, "send_error");
  if (target.scopes.includes(GMAIL_SEND_SCOPE)) {
    return sendFeedbackRedirect(request, "send_already_enabled");
  }

  try {
    const state = createGmailOAuthState(
      account.userId,
      account.workspaceId,
      "ENABLE_SEND",
      target.id,
    );
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
      scope: [...GMAIL_SEND_UPGRADE_SCOPES],
      state: state.nonce,
    });
    return NextResponse.redirect(authorizationUrl);
  } catch {
    return sendFeedbackRedirect(request, "send_error");
  }
}

function sendFeedbackRedirect(request: NextRequest, feedback: string) {
  return NextResponse.redirect(new URL(`/settings?gmail=${feedback}`, request.url));
}
