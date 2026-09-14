import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { ChannelAdapterRegistry } from "../core/channel-adapter-registry";
import { executeChannelOutboundAction } from "./execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "./load-channel-adapter";

export type ManualFacebookDispatchResult = "SENT" | "FAILED" | "DELIVERY_UNKNOWN" | "NOT_ELIGIBLE" | "UNAVAILABLE";

export async function dispatchManualFacebookAction(actionId: string): Promise<ManualFacebookDispatchResult> {
  const account = await getAccountContext();
  if (!account?.configurationComplete || !account.workspaceId) return "UNAVAILABLE";
  const sessionClient = await createClient();
  const { data: action, error } = await sessionClient.from("channel_outbound_actions")
    .select("id,workspace_id,channel_account_id,conversation_id,channel_type,status,attempt_count")
    .eq("id", actionId).eq("workspace_id", account.workspaceId).maybeSingle();
  if (error || !action) return "UNAVAILABLE";
  if (action.channel_type !== "FACEBOOK" || action.status !== "APPROVED" || action.attempt_count !== 0 ||
      typeof action.channel_account_id !== "string" || typeof action.conversation_id !== "string") return "NOT_ELIGIBLE";

  try {
    const loaded = await loadChannelAdapterByAccountId(action.channel_account_id);
    if (loaded.channelAccountId !== action.channel_account_id || loaded.adapter.channelType !== "FACEBOOK") return "UNAVAILABLE";
    const registry = new ChannelAdapterRegistry();
    registry.register(loaded.adapter);
    const result = await executeChannelOutboundAction(actionId, registry);
    return result.status;
  } catch {
    return "UNAVAILABLE";
  }
}
