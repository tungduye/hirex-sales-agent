import "server-only";

import { decryptCredential, encryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";
import { createGoogleOAuthClient } from "@/modules/integrations/gmail/server/oauth-client";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

interface CredentialRow {
  id: string;
  workspace_id: string;
  email_address: string;
  status: string;
  refresh_token_encrypted: string | null;
  access_token_encrypted: string | null;
  access_token_expires_at: string | null;
}

export class ReauthenticationRequiredError extends Error {}
export class TransientCredentialError extends Error {}

export async function loadSyncCredentials(emailAccountId: string, workspaceId: string) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase.from("email_accounts")
    .select("id, workspace_id, email_address, status, refresh_token_encrypted, access_token_encrypted, access_token_expires_at")
    .eq("id", emailAccountId).eq("workspace_id", workspaceId).eq("provider", "GMAIL").maybeSingle();
  const account = data as CredentialRow | null;
  if (error || !account) throw new Error("EMAIL_ACCOUNT_NOT_FOUND");
  if (account.status !== "CONNECTED" || !account.refresh_token_encrypted) return requireReauthentication(supabase, account.id, workspaceId);

  let refreshToken: string;
  let accessToken: string | null = null;
  try {
    refreshToken = decryptCredential(account.refresh_token_encrypted);
    if (account.access_token_encrypted) accessToken = decryptCredential(account.access_token_encrypted);
  } catch {
    return requireReauthentication(supabase, account.id, workspaceId);
  }

  const expiresAt = account.access_token_expires_at ? new Date(account.access_token_expires_at).getTime() : 0;
  const needsRefresh = !accessToken || !expiresAt || expiresAt <= Date.now() + 60_000;
  if (needsRefresh) {
    const oauth = createGoogleOAuthClient();
    oauth.setCredentials({ access_token: accessToken ?? undefined, refresh_token: refreshToken, expiry_date: expiresAt || undefined });
    try {
      const result = await oauth.getAccessToken();
      accessToken = result.token ?? null;
      if (!accessToken) throw new TransientCredentialError("Credential refresh did not return an access token.");
      const credentials = oauth.credentials;
      const update: Record<string, unknown> = {
        access_token_encrypted: encryptCredential(accessToken),
        access_token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
        status: "CONNECTED",
        last_sync_error: null,
      };
      if (credentials.refresh_token && credentials.refresh_token !== refreshToken) update.refresh_token_encrypted = encryptCredential(credentials.refresh_token);
      const { error: updateError } = await supabase.from("email_accounts").update(update)
        .eq("id", account.id).eq("workspace_id", workspaceId).eq("provider", "GMAIL");
      if (updateError) throw new Error("CREDENTIAL_UPDATE_FAILED");
    } catch (error) {
      if (error instanceof ReauthenticationRequiredError) throw error;
      if (isInvalidGrantError(error)) return requireReauthentication(supabase, account.id, workspaceId);
      throw error instanceof TransientCredentialError
        ? error
        : new TransientCredentialError("Gmail credential refresh failed.");
    }
  }

  if (!accessToken) return requireReauthentication(supabase, account.id, workspaceId);
  return { accessToken, emailAddress: account.email_address };
}

function isInvalidGrantError(error: unknown) {
  if (!isRecord(error)) return false;
  const response = error.response;
  if (!isRecord(response)) return false;
  const data = response.data;
  return isRecord(data) && data.error === "invalid_grant";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function markReauthenticationRequired(emailAccountId: string, workspaceId: string) {
  const supabase = createPrivilegedSupabaseClient();
  await supabase.from("email_accounts").update({ status: "REAUTH_REQUIRED", last_sync_error: "OAUTH_REAUTH_REQUIRED" })
    .eq("id", emailAccountId).eq("workspace_id", workspaceId).eq("provider", "GMAIL");
}

async function requireReauthentication(supabase: ReturnType<typeof createPrivilegedSupabaseClient>, id: string, workspaceId: string): Promise<never> {
  await supabase.from("email_accounts").update({ status: "REAUTH_REQUIRED", last_sync_error: "OAUTH_REAUTH_REQUIRED" })
    .eq("id", id).eq("workspace_id", workspaceId).eq("provider", "GMAIL");
  throw new ReauthenticationRequiredError("Gmail reconnect required.");
}
