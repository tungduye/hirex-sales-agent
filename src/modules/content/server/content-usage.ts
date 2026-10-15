import "server-only";

import type { createPrivilegedClient } from "@/lib/supabase/privileged";

/** Most content items one campaign takes from the library (a Zalo/Facebook step has ≤ 10 variants). */
export const CAMPAIGN_CONTENT_LIMIT = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = ReturnType<typeof createPrivilegedClient>;

/** Library content picked in a campaign form ("contentItemIds" hidden inputs). */
export function contentItemIdsFrom(formData: FormData): string[] {
  return [...new Set(formData.getAll("contentItemIds").filter((value): value is string => typeof value === "string" && UUID.test(value)))].slice(0, CAMPAIGN_CONTENT_LIMIT);
}

/** Ids that cannot be used: not in this workspace's library, or already used by another campaign. */
export async function unavailableContent(db: Db, workspaceId: string, ids: string[], ownCampaignId?: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const [{ data: items, error: itemError }, { data: used, error: usedError }] = await Promise.all([
    db.from("content_items").select("id").eq("workspace_id", workspaceId).in("id", ids),
    db.from("content_item_usages").select("content_item_id, campaign_id").eq("workspace_id", workspaceId).in("content_item_id", ids),
  ]);
  if (itemError || usedError) return ids;
  const existing = new Set((items ?? []).map((row) => row.id as string));
  const taken = new Set((used ?? []).filter((row) => row.campaign_id !== ownCampaignId).map((row) => row.content_item_id as string));
  return ids.filter((id) => !existing.has(id) || taken.has(id));
}

/**
 * Marks the content as used by this campaign. All or nothing from the caller's point of view: false
 * when any item was taken by another campaign in the meantime (the caller then rolls back).
 */
export async function reserveContent(db: Db, input: { workspaceId: string; kind: "EMAIL" | "CHANNEL"; campaignId: string; userId: string; ids: string[] }): Promise<boolean> {
  if (input.ids.length === 0) return true;
  // Items this campaign already holds (form saved again) need nothing.
  const { data: held } = await db.from("content_item_usages").select("content_item_id").eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).in("content_item_id", input.ids);
  const heldIds = new Set((held ?? []).map((row) => row.content_item_id as string));
  const ids = input.ids.filter((id) => !heldIds.has(id));
  if (ids.length === 0) return true;
  const { data, error } = await db.from("content_item_usages")
    .upsert(ids.map((id) => ({ content_item_id: id, workspace_id: input.workspaceId, campaign_kind: input.kind, campaign_id: input.campaignId, used_by: input.userId })), { onConflict: "content_item_id", ignoreDuplicates: true })
    .select("content_item_id");
  if (error) return false;
  if ((data ?? []).length === ids.length) return true;
  // Partly reserved: give back what this call took so the library stays consistent.
  const mine = (data ?? []).map((row) => row.content_item_id as string);
  if (mine.length) await db.from("content_item_usages").delete().eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).in("content_item_id", mine);
  return false;
}
