import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { DELIVERY_EVENT_TYPES, summarizeDeliveryEvents, type DeliveryEventType } from "../core/delivery-reporting";

export async function getChannelDeliveryReport() {
  const empty = summarizeDeliveryEvents([]);
  const account = await getAccountContext();
  if (!account?.workspaceId) return { report: empty, byChannel: [], error: "Reporting is unavailable." };
  const client = await createClient();
  const [events, actions] = await Promise.all([
    client.from("channel_delivery_events").select("outbound_action_id,event_type").eq("workspace_id", account.workspaceId).not("outbound_action_id", "is", null).order("occurred_at", { ascending: false }).limit(10_000),
    client.from("channel_outbound_actions").select("id,channel_type,status").eq("workspace_id", account.workspaceId).order("created_at", { ascending: false }).limit(10_000),
  ]);
  if (events.error || actions.error) return { report: empty, byChannel: [], error: "Omnichannel reporting is not available yet." };
  const normalized = (events.data ?? []).flatMap((row) => typeof row.outbound_action_id === "string" && typeof row.event_type === "string" && DELIVERY_EVENT_TYPES.includes(row.event_type as DeliveryEventType) ? [{ outboundActionId: row.outbound_action_id, eventType: row.event_type as DeliveryEventType }] : []);
  const channelCounts = new Map<string, { channelType: string; actions: number; sent: number; failed: number; unknown: number }>();
  for (const action of actions.data ?? []) { if (typeof action.channel_type !== "string" || typeof action.status !== "string") continue; const value=channelCounts.get(action.channel_type)??{channelType:action.channel_type,actions:0,sent:0,failed:0,unknown:0}; value.actions+=1; if(action.status==="SENT")value.sent+=1; if(action.status==="FAILED")value.failed+=1; if(action.status==="DELIVERY_UNKNOWN")value.unknown+=1; channelCounts.set(action.channel_type,value); }
  return { report: summarizeDeliveryEvents(normalized), byChannel: [...channelCounts.values()], error: null };
}
