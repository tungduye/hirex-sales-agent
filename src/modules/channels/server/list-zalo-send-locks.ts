import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import type { ZaloSendLock } from "../core/send-locks";

/** Locked Zalo nicks the signed-in member may use (published by the send-lock reconciler). */
export async function listZaloSendLocks(channelAccountId?: string): Promise<{ locks: ZaloSendLock[]; checkedAt: number }> {
  const checkedAt = Date.now();
  return { locks: await loadLocks(channelAccountId), checkedAt };
}

async function loadLocks(channelAccountId?: string): Promise<ZaloSendLock[]> {
  const account = await getAccountContext();
  if (!account?.configurationComplete || !account.workspaceId) return [];
  const accessible = await getAccessibleChannelAccountIds();
  if (accessible?.length === 0) return [];
  const client = createPrivilegedClient();
  let query = client.from("zalo_account_send_locks").select("channel_account_id,reason,locked_since,auto_release_at,conversation_id")
    .eq("workspace_id", account.workspaceId).order("locked_since");
  if (accessible) query = query.in("channel_account_id", accessible);
  if (channelAccountId) query = query.eq("channel_account_id", channelAccountId);
  const { data, error } = await query;
  if (error || !data?.length) return [];
  const names = await client.from("channel_accounts").select("id,display_name").eq("workspace_id", account.workspaceId)
    .in("id", data.map((row) => String(row.channel_account_id)));
  const nameById = new Map<string, string>((names.data ?? []).map((row) => [String(row.id), typeof row.display_name === "string" && row.display_name.trim() ? row.display_name : "Nick Zalo"]));
  return data.flatMap((row) => {
    if (typeof row.channel_account_id !== "string" || (row.reason !== "DELIVERY_UNKNOWN" && row.reason !== "SENDING") || typeof row.locked_since !== "string") return [];
    return [{ channelAccountId: row.channel_account_id, accountName: nameById.get(row.channel_account_id) ?? "Nick Zalo", reason: row.reason,
      lockedSince: row.locked_since, autoReleaseAt: typeof row.auto_release_at === "string" ? row.auto_release_at : null,
      conversationId: typeof row.conversation_id === "string" ? row.conversation_id : null }];
  });
}
