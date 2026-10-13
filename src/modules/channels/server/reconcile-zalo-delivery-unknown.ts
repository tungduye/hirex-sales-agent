import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { ZaloBridgeAdapter } from "../adapters/zalo/zalo-bridge-adapter";
import { loadChannelAdapterByAccountId } from "./load-channel-adapter";

export type ReconcileUnknownResult = "ACKNOWLEDGED_NO_RETRY" | "NOT_ELIGIBLE" | "UNAVAILABLE";

export async function reconcileZaloDeliveryUnknown(actionId: string): Promise<ReconcileUnknownResult> {
  const account = await getAccountContext();
  if (!account?.configurationComplete || !account.workspaceId || !account.userId) return "UNAVAILABLE";
  const client = createPrivilegedClient();
  const { data: action, error } = await client.from("channel_outbound_actions")
    .select("id,workspace_id,channel_account_id,channel_type,status,idempotency_key,reconciliation_status,retry_allowed")
    .eq("id", actionId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (error || !action) return "UNAVAILABLE";
  if (action.channel_type !== "ZALO" || action.status !== "DELIVERY_UNKNOWN" || typeof action.channel_account_id !== "string" ||
      typeof action.idempotency_key !== "string" || action.retry_allowed !== false ||
      !["NONE","NEEDS_REVIEW","ACKNOWLEDGED_NO_RETRY"].includes(String(action.reconciliation_status))) return "NOT_ELIGIBLE";
  if (action.reconciliation_status !== "ACKNOWLEDGED_NO_RETRY") {
    let loaded; try { loaded = await loadChannelAdapterByAccountId(action.channel_account_id); } catch { return "UNAVAILABLE"; }
    if (!(loaded.adapter instanceof ZaloBridgeAdapter) || !(await loaded.adapter.acknowledgeUnknownNoRetry(action.idempotency_key))) return "UNAVAILABLE";
  }
  const { data, error: rpcError } = await client.rpc("acknowledge_channel_delivery_unknown_no_retry", {
    p_workspace_id: account.workspaceId, p_action_id: action.id, p_reconciled_by: account.userId,
  });
  return !rpcError && data === true ? "ACKNOWLEDGED_NO_RETRY" : "UNAVAILABLE";
}
