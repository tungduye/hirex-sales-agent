import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { CHANNEL_ACCOUNT_STATUSES, CHANNEL_TYPES, type ChannelCapability } from "../core/channel-contracts";
import type { ChannelAccountSummary, ChannelAccountsResult } from "../types/channel-account";

interface ChannelAccountRow {
  id: unknown;
  channel_type: unknown;
  provider: unknown;
  external_account_id: unknown;
  display_name: unknown;
  status: unknown;
  capabilities: unknown;
  last_health_check_at: unknown;
  last_error_code: unknown;
}

const allowedCapabilities = new Set<ChannelCapability>([
  "SEND_TEXT", "SEND_IMAGE", "SEND_FILE", "REPLY", "REACTIONS",
  "DELIVERY_RECEIPTS", "READ_RECEIPTS", "TYPING_INDICATOR", "TEMPLATES", "COMMENTS",
]);

function mapRow(row: ChannelAccountRow): ChannelAccountSummary | null {
  if (
    typeof row.id !== "string" ||
    typeof row.channel_type !== "string" ||
    !CHANNEL_TYPES.includes(row.channel_type as never) ||
    typeof row.provider !== "string" ||
    typeof row.external_account_id !== "string" ||
    typeof row.status !== "string" ||
    !CHANNEL_ACCOUNT_STATUSES.includes(row.status as never) ||
    !Array.isArray(row.capabilities) ||
    !row.capabilities.every((item) => typeof item === "string" && allowedCapabilities.has(item as ChannelCapability))
  ) return null;
  return {
    id: row.id,
    channelType: row.channel_type as ChannelAccountSummary["channelType"],
    provider: row.provider,
    externalAccountId: row.external_account_id,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    status: row.status as ChannelAccountSummary["status"],
    capabilities: row.capabilities as ChannelCapability[],
    lastHealthCheckAt: typeof row.last_health_check_at === "string" ? row.last_health_check_at : null,
    lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : null,
  };
}

export async function listChannelAccounts(): Promise<ChannelAccountsResult> {
  const account = await getAccountContext();
  if (!account?.configurationComplete || !account.workspaceId) return { accounts: [], error: "Account configuration is incomplete." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channel_accounts")
    .select("id,channel_type,provider,external_account_id,display_name,status,capabilities,last_health_check_at,last_error_code")
    .eq("workspace_id", account.workspaceId)
    .order("channel_type")
    .order("display_name");
  if (error) return { accounts: [], error: "Channel accounts are not available yet." };
  const accounts = (data as ChannelAccountRow[]).map(mapRow);
  if (accounts.some((item) => item === null)) return { accounts: [], error: "Channel account data is unavailable." };
  return { accounts: accounts as ChannelAccountSummary[], error: null };
}
