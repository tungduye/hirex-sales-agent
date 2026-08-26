import "server-only";

import { encryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";
import { createPrivilegedSupabaseClient } from "@/modules/integrations/gmail/server/privileged-supabase";

interface UpgradeInput {
  emailAccountId: string;
  workspaceId: string;
  authorizedEmail: string;
  providerAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: string;
  scopes: string[];
}

interface TargetAccountRow {
  id: string;
  email_address: string;
  provider_account_id: string | null;
  updated_at: string;
}

export type GmailSendUpgradeResult =
  | "UPDATED"
  | "ACCOUNT_MISMATCH"
  | "TARGET_UNAVAILABLE"
  | "UPDATE_FAILED";

export async function verifyGmailSendUpgradeTarget(input: {
  emailAccountId: string;
  workspaceId: string;
  authorizedEmail: string;
  providerAccountId: string;
}): Promise<"MATCH" | "ACCOUNT_MISMATCH" | "TARGET_UNAVAILABLE"> {
  const target = await loadConnectedTarget(input.emailAccountId, input.workspaceId);
  if (!target) return "TARGET_UNAVAILABLE";
  return identityMatches(target, input.authorizedEmail, input.providerAccountId)
    ? "MATCH"
    : "ACCOUNT_MISMATCH";
}

export async function upgradeGmailSendCredentials(
  input: UpgradeInput,
): Promise<GmailSendUpgradeResult> {
  const target = await loadConnectedTarget(input.emailAccountId, input.workspaceId);
  if (!target) return "TARGET_UNAVAILABLE";
  if (!identityMatches(target, input.authorizedEmail, input.providerAccountId)) return "ACCOUNT_MISMATCH";

  const supabase = createPrivilegedSupabaseClient();
  const update: Record<string, unknown> = {
    scopes: input.scopes,
    access_token_encrypted: encryptCredential(input.accessToken),
    access_token_expires_at: input.accessTokenExpiresAt,
    status: "CONNECTED",
  };
  if (input.refreshToken) {
    update.refresh_token_encrypted = encryptCredential(input.refreshToken);
  }

  const { data: updated, error: updateError } = await supabase
    .from("email_accounts")
    .update(update)
    .eq("id", target.id)
    .eq("workspace_id", input.workspaceId)
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .eq("email_address", target.email_address)
    .eq("updated_at", target.updated_at)
    .select("id")
    .maybeSingle();

  return updateError || !updated ? "UPDATE_FAILED" : "UPDATED";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function identityMatches(
  target: TargetAccountRow,
  authorizedEmail: string,
  providerAccountId: string,
) {
  return normalizeEmail(target.email_address) === authorizedEmail
    && (!target.provider_account_id || target.provider_account_id === providerAccountId);
}

async function loadConnectedTarget(emailAccountId: string, workspaceId: string) {
  const supabase = createPrivilegedSupabaseClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, email_address, provider_account_id, updated_at")
    .eq("id", emailAccountId)
    .eq("workspace_id", workspaceId)
    .eq("provider", "GMAIL")
    .eq("status", "CONNECTED")
    .maybeSingle();
  return error || !data ? null : data as TargetAccountRow;
}
