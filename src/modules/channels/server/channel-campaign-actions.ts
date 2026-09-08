"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type { ChannelActionState } from "../types/channel-action-state";

const schema = z.object({ name: z.string().trim().min(1).max(160), message: z.string().trim().min(1).max(100000), delayMinutes: z.coerce.number().int().min(0).max(525600), channels: z.array(z.enum(["EMAIL","FACEBOOK","ZALO","WHATSAPP","VIBER","TELEGRAM","OTHER"])).min(1), contactIds: z.array(z.string().uuid()).min(1), senderIds: z.array(z.string().uuid()).min(1) });

export async function createChannelCampaign(_state: ChannelActionState, formData: FormData): Promise<ChannelActionState> {
  const parsed = schema.safeParse({ ...Object.fromEntries(formData), channels: formData.getAll("channels"), contactIds: formData.getAll("contactIds"), senderIds: formData.getAll("senderIds") });
  const account = await getAccountContext();
  if (!parsed.success || !account?.workspaceId) return { status: "error", message: "Campaign configuration is invalid." };
  const client = await createClient();
  const { data: campaignId, error } = await client.rpc("create_channel_campaign_draft", { p_name: parsed.data.name });
  if (error || typeof campaignId !== "string") return { status: "error", message: "Campaign could not be created." };
  const step = await client.rpc("add_channel_campaign_step", { p_campaign_id: campaignId, p_delay_minutes: parsed.data.delayMinutes, p_text_template: parsed.data.message, p_allowed_channels: parsed.data.channels });
  if (step.error || typeof step.data !== "string") return { status: "error", message: "Campaign draft was created, but its step could not be saved." };
  for (const contactId of parsed.data.contactIds) { const result = await client.rpc("add_channel_campaign_recipient", { p_campaign_id: campaignId, p_contact_id: contactId }); if (result.error || typeof result.data !== "string") return { status: "error", message: "Campaign draft was created, but its audience could not be saved." }; }
  for (const senderId of parsed.data.senderIds) { const result = await client.rpc("add_channel_campaign_sender", { p_campaign_id: campaignId, p_channel_account_id: senderId, p_priority: 100 }); if (result.error || typeof result.data !== "string") return { status: "error", message: "Campaign draft was created, but its sender could not be saved." }; }
  redirect(`/campaigns/omnichannel/${campaignId}`);
}
