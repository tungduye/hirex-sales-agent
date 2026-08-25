import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChannelType } from "@/modules/crm/contact-channels/types/contact-channel";

export async function contactBelongsToWorkspace(
  supabase: SupabaseClient,
  contactId: string,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  return !error && Boolean(data);
}

export async function getChannelForMutation(
  supabase: SupabaseClient,
  channelId: string,
  contactId: string,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("contact_channels")
    .select("id, channel_type, channel_value, is_primary")
    .eq("id", channelId)
    .eq("contact_id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !data) return null;
  return data as {
    id: string;
    channel_type: ChannelType;
    channel_value: string;
    is_primary: boolean;
  };
}
