import "server-only";

import { getGmailServerConfig } from "@/modules/integrations/gmail/server/config";
import { createGoogleOAuthClient, GMAIL_SEND_SCOPE } from "@/modules/integrations/gmail/server/oauth-client";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";
import {
  loadSyncCredentials,
  ReauthenticationRequiredError,
  TransientCredentialError,
} from "@/modules/integrations/gmail/server/sync-credentials";

export class GmailSendCredentialError extends Error {
  constructor(readonly safeCode: "REAUTH_REQUIRED" | "SEND_SCOPE_REQUIRED" | "GMAIL_TEMPORARY_ERROR") {
    super("Gmail send credential is unavailable.");
  }
}

export async function loadGmailSendCredentials(emailAccountId: string, workspaceId: string) {
  const supabase = createPrivilegedSupabaseClient();
  const { data: account, error: accountError } = await supabase
    .from("email_accounts")
    .select("id, email_address, provider_account_id, scopes")
    .eq("id", emailAccountId)
    .eq("workspace_id", workspaceId)
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .maybeSingle();
  if (accountError || !account) {
    throw new GmailSendCredentialError("REAUTH_REQUIRED");
  }
  if (!(account.scopes as string[]).includes(GMAIL_SEND_SCOPE)) {
    throw new GmailSendCredentialError("SEND_SCOPE_REQUIRED");
  }

  let credential: Awaited<ReturnType<typeof loadSyncCredentials>>;
  try {
    credential = await loadSyncCredentials(emailAccountId, workspaceId);
  } catch (error) {
    if (error instanceof ReauthenticationRequiredError) {
      throw new GmailSendCredentialError("REAUTH_REQUIRED");
    }
    if (error instanceof TransientCredentialError) {
      throw new GmailSendCredentialError("GMAIL_TEMPORARY_ERROR");
    }
    throw new GmailSendCredentialError("GMAIL_TEMPORARY_ERROR");
  }

  try {
    const tokenInfo = await createGoogleOAuthClient().getTokenInfo(credential.accessToken);
    if (tokenInfo.aud !== getGmailServerConfig().googleClientId) {
      throw new GmailSendCredentialError("GMAIL_TEMPORARY_ERROR");
    }
    if (!tokenInfo.email
      || tokenInfo.email.trim().toLowerCase() !== (account.email_address as string).trim().toLowerCase()) {
      throw new GmailSendCredentialError("GMAIL_TEMPORARY_ERROR");
    }
    const providerAccountId = account.provider_account_id as string | null;
    if (providerAccountId && (!tokenInfo.sub || tokenInfo.sub !== providerAccountId)) {
      throw new GmailSendCredentialError("GMAIL_TEMPORARY_ERROR");
    }
    if (!tokenInfo.scopes.includes(GMAIL_SEND_SCOPE)) {
      throw new GmailSendCredentialError("SEND_SCOPE_REQUIRED");
    }
    if (!Number.isFinite(tokenInfo.expiry_date) || tokenInfo.expiry_date <= Date.now()) {
      throw new GmailSendCredentialError("GMAIL_TEMPORARY_ERROR");
    }
    return credential;
  } catch (error) {
    if (error instanceof GmailSendCredentialError) throw error;
    throw new GmailSendCredentialError("GMAIL_TEMPORARY_ERROR");
  }
}
