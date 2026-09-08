import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { isChannelType } from "../core/channel-contracts";
import type { ChannelSuppressionSummary } from "../types/channel-suppression";

export async function listChannelSuppressions(): Promise<{ suppressions: ChannelSuppressionSummary[]; error: string | null }> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { suppressions: [], error: "Suppressions are unavailable." };
  const client = await createClient();
  const { data, error } = await client.from("channel_suppressions").select("id,channel_type,normalized_recipient,reason,source,created_at").eq("workspace_id", account.workspaceId).order("created_at", { ascending: false }).limit(500);
  if (error) return { suppressions: [], error: "Suppressions are not available yet." };
  return { suppressions: (data ?? []).flatMap((row) => typeof row.id === "string" && isChannelType(row.channel_type) && typeof row.normalized_recipient === "string" && typeof row.reason === "string" && typeof row.source === "string" && typeof row.created_at === "string" ? [{ id: row.id, channelType: row.channel_type, recipient: row.normalized_recipient, reason: row.reason, source: row.source, createdAt: row.created_at }] : []), error: null };
}
