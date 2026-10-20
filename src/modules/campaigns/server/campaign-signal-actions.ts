"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/modules/access/server/access-control";
import { processPersistedCampaignBounces, processPersistedCampaignReplies } from "@/modules/campaigns/server/process-campaign-signals";

/** "Quét lại phản hồi": catch up on replies and bounces already in the synced mailboxes. */
export async function rescanCampaignSignals(): Promise<{ ok: boolean; replies: number; bounces: number }> {
  await requirePermission("campaigns.update");
  let replies = 0, bounces = 0, ok = true;
  // A few rounds so a big backlog is cleared in one click (each round handles up to 2000).
  for (let round = 0; round < 5; round++) {
    const result = await processPersistedCampaignReplies(2000);
    if (result.error) { ok = false; break; }
    replies += result.repliedStopped;
    if (result.repliedStopped === 0) break;
  }
  for (let round = 0; round < 5; round++) {
    const result = await processPersistedCampaignBounces(2000);
    if (result.error) { ok = false; break; }
    bounces += result.bouncedStopped;
    if (result.bouncedStopped === 0) break;
  }
  revalidatePath("/campaigns");
  return { ok, replies, bounces };
}
