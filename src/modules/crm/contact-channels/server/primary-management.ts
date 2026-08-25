import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelType } from "@/modules/crm/contact-channels/types/contact-channel";

interface PrimaryScope {
  workspaceId: string;
  contactId: string;
  channelType: ChannelType;
  excludeChannelId?: string;
}

export interface UnsetPrimaryResult {
  success: boolean;
  previousPrimaryIds: string[];
}

export async function unsetPrimaryChannels(
  supabase: SupabaseClient,
  scope: PrimaryScope,
): Promise<UnsetPrimaryResult> {
  let selectQuery = supabase
    .from("contact_channels")
    .select("id")
    .eq("workspace_id", scope.workspaceId)
    .eq("contact_id", scope.contactId)
    .eq("channel_type", scope.channelType)
    .eq("is_primary", true);

  if (scope.excludeChannelId) selectQuery = selectQuery.neq("id", scope.excludeChannelId);

  const { data, error } = await selectQuery;
  if (error) return { success: false, previousPrimaryIds: [] };

  const previousPrimaryIds = (data as { id: string }[]).map((row) => row.id);
  if (previousPrimaryIds.length === 0) return { success: true, previousPrimaryIds };

  const { data: updated, error: updateError } = await supabase
    .from("contact_channels")
    .update({ is_primary: false })
    .in("id", previousPrimaryIds)
    .eq("workspace_id", scope.workspaceId)
    .eq("contact_id", scope.contactId)
    .eq("channel_type", scope.channelType)
    .select("id");

  return {
    success: !updateError && updated?.length === previousPrimaryIds.length,
    previousPrimaryIds,
  };
}

export async function restorePrimaryChannels(
  supabase: SupabaseClient,
  scope: PrimaryScope,
  channelIds: string[],
) {
  if (channelIds.length === 0) return true;

  const { data, error } = await supabase
    .from("contact_channels")
    .update({ is_primary: true })
    .in("id", channelIds)
    .eq("workspace_id", scope.workspaceId)
    .eq("contact_id", scope.contactId)
    .eq("channel_type", scope.channelType)
    .select("id");

  return !error && data?.length === channelIds.length;
}
