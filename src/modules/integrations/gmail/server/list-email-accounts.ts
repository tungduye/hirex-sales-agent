import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { EmailAccountMetadata, EmailAccountStatus } from "@/modules/integrations/gmail/types/email-account";

interface EmailAccountMetadataRow {
  id: string;
  provider: "GMAIL";
  email_address: string;
  display_name: string | null;
  status: EmailAccountStatus;
  scopes: string[];
  last_sync_at: string | null;
  created_at: string;
}

interface ListEmailAccountsResult {
  accounts: EmailAccountMetadata[];
  error: string | null;
}

export async function listEmailAccounts(): Promise<ListEmailAccountsResult> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) {
    return { accounts: [], error: "Email accounts could not be loaded." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, provider, email_address, display_name, status, scopes, last_sync_at, created_at")
    .eq("workspace_id", account.workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    return { accounts: [], error: "Email accounts could not be loaded. Please try again." };
  }

  return {
    accounts: (data as EmailAccountMetadataRow[]).map((row) => ({
      id: row.id,
      provider: row.provider,
      emailAddress: row.email_address,
      displayName: row.display_name,
      status: row.status,
      scopes: row.scopes,
      lastSyncAt: row.last_sync_at,
      createdAt: row.created_at,
    })),
    error: null,
  };
}
