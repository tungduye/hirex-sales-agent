import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

interface StoreGmailAccountInput {
  workspaceId: string;
  connectedBy: string;
  providerAccountId: string | null;
  emailAddress: string;
  displayName: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: string | null;
  scopes: string[];
}

interface ExistingAccount {
  id: string;
}

export async function storeConnectedGmailAccount(input: StoreGmailAccountInput) {
  const supabase = createPrivilegedSupabaseClient();
  const existing = await findExistingAccount(supabase, input);

  if (existing) return updateExistingAccount(supabase, existing, input);

  const { error } = await supabase.from("email_accounts").insert({
    workspace_id: input.workspaceId,
    connected_by: input.connectedBy,
    provider: "GMAIL",
    email_address: input.emailAddress,
    display_name: input.displayName,
    provider_account_id: input.providerAccountId,
    refresh_token_encrypted: input.refreshTokenEncrypted,
    access_token_encrypted: input.accessTokenEncrypted,
    access_token_expires_at: input.accessTokenExpiresAt,
    scopes: input.scopes,
    status: "CONNECTED",
    last_sync_error: null,
  });

  if (!error) return true;
  if (error.code !== "23505") return false;

  const racedAccount = await findExistingAccount(supabase, input);
  return racedAccount ? updateExistingAccount(supabase, racedAccount, input) : false;
}

async function findExistingAccount(
  supabase: SupabaseClient,
  input: StoreGmailAccountInput,
): Promise<ExistingAccount | null> {
  if (input.providerAccountId) {
    const { data, error } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("provider", "GMAIL")
      .eq("provider_account_id", input.providerAccountId)
      .maybeSingle();

    if (error) return null;
    if (data) return data as ExistingAccount;
  }

  const { data, error } = await supabase
    .from("email_accounts")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("provider", "GMAIL")
    .ilike("email_address", input.emailAddress)
    .maybeSingle();

  return error || !data ? null : data as ExistingAccount;
}

async function updateExistingAccount(
  supabase: SupabaseClient,
  existing: ExistingAccount,
  input: StoreGmailAccountInput,
) {
  const update: Record<string, unknown> = {
    connected_by: input.connectedBy,
    provider_account_id: input.providerAccountId,
    email_address: input.emailAddress,
    display_name: input.displayName,
    scopes: input.scopes,
    status: "CONNECTED",
    last_sync_error: null,
  };

  if (input.refreshTokenEncrypted) {
    update.refresh_token_encrypted = input.refreshTokenEncrypted;
  }
  if (input.accessTokenEncrypted) {
    update.access_token_encrypted = input.accessTokenEncrypted;
    update.access_token_expires_at = input.accessTokenExpiresAt;
  }

  const { data, error } = await supabase
    .from("email_accounts")
    .update(update)
    .eq("id", existing.id)
    .eq("workspace_id", input.workspaceId)
    .eq("provider", "GMAIL")
    .select("id")
    .maybeSingle();

  return !error && Boolean(data);
}
