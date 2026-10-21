import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { summarizeDeliveryEvents } from "../core/delivery-reporting";

export interface ChannelActionCounts { channelType: string; actions: number; sent: number; pending: number; failed: number; unknown: number }
function emptyCounts(channelType: string): ChannelActionCounts { return { channelType, actions: 0, sent: 0, pending: 0, failed: 0, unknown: 0 }; }

export async function getChannelDeliveryReport() {
  const empty = summarizeDeliveryEvents([]);
  const none = { byChannel: [] as ChannelActionCounts[], totals: emptyCounts("ALL"), hasProviderEvents: false, truncated: false };
  const account = await getAccountContext();
  if (!account?.workspaceId) return { report: empty, ...none, error: "Không tải được dữ liệu báo cáo." };
  const client = await createClient();
  // Added up in the database (this page used to download up to 20,000 sends and their receipts, page by page).
  const { data, error } = await client.rpc("channel_delivery_summary");
  if (error) return { report: empty, ...none, error: "Báo cáo đa kênh tạm thời không khả dụng." };
  const rows = (data ?? []) as Array<{ kind: string; key: string | null; status: string | null; total: number }>;
  const eventCount = (type: string) => Number(rows.find((row) => row.kind === "EVENT" && row.key === type)?.total ?? 0);
  const report = { ...empty, actions: Number(rows.find((row) => row.kind === "EVENT_ACTIONS")?.total ?? 0), accepted: eventCount("ACCEPTED"), delivered: eventCount("DELIVERED"),
    read: eventCount("READ"), clicked: eventCount("CLICKED"), replied: eventCount("REPLIED"), failed: eventCount("FAILED"), unknown: eventCount("UNKNOWN") };
  const actions = { data: rows.filter((row) => row.kind === "ACTION").map((row) => ({ channel_type: row.key, status: row.status, total: Number(row.total) })) };
  const channelCounts = new Map<string, ChannelActionCounts>();
  for (const action of actions.data) {
    if (typeof action.channel_type !== "string" || typeof action.status !== "string") continue;
    const value = channelCounts.get(action.channel_type) ?? emptyCounts(action.channel_type);
    value.actions += action.total;
    if (action.status === "SENT") value.sent += action.total;
    else if (action.status === "FAILED") value.failed += action.total;
    else if (action.status === "DELIVERY_UNKNOWN") value.unknown += action.total;
    else if (action.status !== "CANCELLED") value.pending += action.total;
    channelCounts.set(action.channel_type, value);
  }
  const byChannel = [...channelCounts.values()].sort((a, b) => b.actions - a.actions);
  // Headline numbers come from our own outbound actions, which every channel records.
  // Provider receipts (delivered/read/clicked) only exist when a provider sends them.
  const totals = byChannel.reduce((sum, row) => ({ ...sum, actions: sum.actions + row.actions, sent: sum.sent + row.sent, failed: sum.failed + row.failed, unknown: sum.unknown + row.unknown, pending: sum.pending + row.pending }), emptyCounts("ALL"));
  return {
    report, byChannel, totals, hasProviderEvents: report.actions > 0, truncated: false, error: null,
  };
}
