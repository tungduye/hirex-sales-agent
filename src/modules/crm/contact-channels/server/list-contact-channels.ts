import "server-only";

import { createClient } from "@/lib/supabase/server";
import { contactIdSchema } from "@/modules/crm/contact-channels/schemas/contact-channel-schema";
import type { ChannelType, ContactChannel, MarketingConsentStatus } from "@/modules/crm/contact-channels/types/contact-channel";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

interface ContactChannelRow {
  id: string;
  channel_type: ChannelType;
  channel_value: string;
  is_primary: boolean;
  marketing_consent_status: MarketingConsentStatus;
  marketing_consent_source: string | null;
  marketing_consent_recorded_at: string | null;
  created_at: string;
}

interface ListContactChannelsResult {
  channels: ContactChannel[];
  error: string | null;
}

export async function listContactChannels(contactId: string): Promise<ListContactChannelsResult> {
  const parsedContactId = contactIdSchema.safeParse(contactId);
  const account = await getAccountContext();

  if (!parsedContactId.success || !account?.workspaceId || !account.configurationComplete) {
    return { channels: [], error: "Contact channels could not be loaded." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact_channels")
    .select("id, channel_type, channel_value, is_primary, marketing_consent_status, marketing_consent_source, marketing_consent_recorded_at, created_at")
    .eq("contact_id", parsedContactId.data)
    .eq("workspace_id", account.workspaceId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    return { channels: [], error: "Contact channels could not be loaded. Please try again." };
  }

  return {
    channels: (data as ContactChannelRow[]).map((row) => ({
      id: row.id,
      channelType: row.channel_type,
      channelValue: row.channel_value,
      isPrimary: row.is_primary,
      marketingConsentStatus: row.marketing_consent_status,
      marketingConsentSource: row.marketing_consent_source,
      marketingConsentRecordedAt: row.marketing_consent_recorded_at,
      createdAt: row.created_at,
    })),
    error: null,
  };
}
