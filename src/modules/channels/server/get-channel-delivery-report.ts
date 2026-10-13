import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { DELIVERY_EVENT_TYPES, summarizeDeliveryEvents, type DeliveryEventType } from "../core/delivery-reporting";

const ACTION_LIMIT = 10_000;

export interface ChannelActionCounts { channelType: string; actions: number; sent: number; pending: number; failed: number; unknown: number }
function emptyCounts(channelType: string): ChannelActionCounts { return { channelType, actions: 0, sent: 0, pending: 0, failed: 0, unknown: 0 }; }

export async function getChannelDeliveryReport() {
  const empty = summarizeDeliveryEvents([]);
  const none = { byChannel: [] as ChannelActionCounts[], totals: emptyCounts("ALL"), hasProviderEvents: false, truncated: false };
  const account = await getAccountContext();
  if (!account?.workspaceId) return { report: empty, ...none, error: "Không tải được dữ liệu báo cáo." };
  const client = await createClient();
  const [events, actions] = await Promise.all([
    client.from("channel_delivery_events").select("outbound_action_id,event_type").eq("workspace_id", account.workspaceId).not("outbound_action_id", "is", null).order("occurred_at", { ascending: false }).limit(10_000),
    client.from("channel_outbound_actions").select("id,channel_type,status").eq("workspace_id", account.workspaceId).order("created_at", { ascending: false }).limit(ACTION_LIMIT),
  ]);
  if (events.error || actions.error) return { report: empty, ...none, error: "Báo cáo đa kênh tạm thời không khả dụng." };
  const normalized = (events.data ?? []).flatMap((row) => typeof row.outbound_action_id === "string" && typeof row.event_type === "string" && DELIVERY_EVENT_TYPES.includes(row.event_type as DeliveryEventType) ? [{ outboundActionId: row.outbound_action_id, eventType: row.event_type as DeliveryEventType }] : []);
  const channelCounts = new Map<string, ChannelActionCounts>();
  for (const action of actions.data ?? []) {
    if (typeof action.channel_type !== "string" || typeof action.status !== "string") continue;
    const value = channelCounts.get(action.channel_type) ?? emptyCounts(action.channel_type);
    value.actions += 1;
    if (action.status === "SENT") value.sent += 1;
    else if (action.status === "FAILED") value.failed += 1;
    else if (action.status === "DELIVERY_UNKNOWN") value.unknown += 1;
    else if (action.status !== "CANCELLED") value.pending += 1;
    channelCounts.set(action.channel_type, value);
  }
  const byChannel = [...channelCounts.values()].sort((a, b) => b.actions - a.actions);
  // Headline numbers come from our own outbound actions, which every channel records.
  // Provider receipts (delivered/read/clicked) only exist when a provider sends them.
  const totals = byChannel.reduce((sum, row) => ({ ...sum, actions: sum.actions + row.actions, sent: sum.sent + row.sent, failed: sum.failed + row.failed, unknown: sum.unknown + row.unknown, pending: sum.pending + row.pending }), emptyCounts("ALL"));
  return {
    report: summarizeDeliveryEvents(normalized), byChannel, totals, hasProviderEvents: normalized.length > 0,
    truncated: (actions.data?.length ?? 0) >= ACTION_LIMIT, error: null,
  };
}
