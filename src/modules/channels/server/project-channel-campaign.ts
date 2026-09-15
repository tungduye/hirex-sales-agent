import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { evaluateChannelCampaignEligibility, type CampaignEligibilitySnapshot } from "../core/evaluate-channel-campaign-eligibility";

// Bounded reads fail closed instead of silently projecting only the first page.
const MAX_ROWS = 1000;
function checked<T>(rows: T[] | null, count: number | null, error: { code?: string } | null): T[] {
  if (error || !rows || count === null || rows.length !== count || count > MAX_ROWS) throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
  return rows;
}

export async function projectChannelCampaign(input: { workspaceId: string; campaignId: string; maximumActions: number }) {
  const db = createPrivilegedClient();
  const campaignResult = await db.from("channel_campaigns").select("id,status").eq("workspace_id", input.workspaceId).eq("id", input.campaignId).maybeSingle();
  if (campaignResult.error) throw new Error("CHANNEL_CAMPAIGN_PROJECTION_UNAVAILABLE");
  if (!campaignResult.data) throw new Error("CHANNEL_CAMPAIGN_NOT_FOUND");
  const [stepsResult, sendersResult, recipientsResult] = await Promise.all([
    db.from("channel_campaign_steps").select("id,position,allowed_channels,text_template,attachment_ids", {count:"exact"}).eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).limit(MAX_ROWS),
    db.from("channel_campaign_senders").select("channel_account_id,priority,enabled", {count:"exact"}).eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).limit(MAX_ROWS),
    db.from("channel_campaign_recipients").select("id,contact_id,status,current_step_position,next_step_at", {count:"exact"}).eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).limit(MAX_ROWS),
  ]);
  const steps = checked(stepsResult.data, stepsResult.count, stepsResult.error);
  const senders = checked(sendersResult.data, sendersResult.count, sendersResult.error);
  const recipients = checked(recipientsResult.data, recipientsResult.count, recipientsResult.error);
  const accountIds = [...new Set(senders.map((sender) => sender.channel_account_id))];
  const contactIds = [...new Set(recipients.map((recipient) => recipient.contact_id))];
  const [accountResult, identityResult, recipientStepResult, conversationResult, suppressionResult] = await Promise.all([
    accountIds.length ? db.from("channel_accounts").select("id,channel_type,status,capabilities,operator_enabled,provider_health_status,provider_health_checked_at", {count:"exact"}).eq("workspace_id", input.workspaceId).in("id", accountIds).limit(MAX_ROWS) : Promise.resolve({ data: [], count: 0, error: null }),
    contactIds.length ? db.from("contact_channels").select("contact_id,channel_type,channel_value,marketing_consent_status", {count:"exact"}).eq("workspace_id", input.workspaceId).in("contact_id", contactIds).limit(MAX_ROWS) : Promise.resolve({ data: [], count: 0, error: null }),
    db.from("channel_campaign_recipient_steps").select("recipient_id,step_id,status", {count:"exact"}).eq("workspace_id", input.workspaceId).eq("campaign_id", input.campaignId).limit(MAX_ROWS),
    accountIds.length ? db.from("omnichannel_conversations").select("channel_account_id,provider_conversation_id,status,last_message_at", {count:"exact"}).eq("workspace_id", input.workspaceId).in("channel_account_id", accountIds).limit(MAX_ROWS) : Promise.resolve({ data: [], count: 0, error: null }),
    db.from("channel_suppressions").select("channel_type,normalized_recipient", {count:"exact"}).eq("workspace_id", input.workspaceId).limit(MAX_ROWS),
  ]);
  const snapshot: CampaignEligibilitySnapshot = {
    campaign: campaignResult.data,
    steps: steps as CampaignEligibilitySnapshot["steps"],
    senders: senders as CampaignEligibilitySnapshot["senders"],
    accounts: checked<unknown>(accountResult.data, accountResult.count, accountResult.error) as CampaignEligibilitySnapshot["accounts"],
    recipients: recipients as CampaignEligibilitySnapshot["recipients"],
    recipientSteps: checked(recipientStepResult.data, recipientStepResult.count, recipientStepResult.error) as CampaignEligibilitySnapshot["recipientSteps"],
    identities: checked<unknown>(identityResult.data, identityResult.count, identityResult.error) as CampaignEligibilitySnapshot["identities"],
    conversations: checked<unknown>(conversationResult.data, conversationResult.count, conversationResult.error) as CampaignEligibilitySnapshot["conversations"],
    suppressions: checked(suppressionResult.data, suppressionResult.count, suppressionResult.error) as CampaignEligibilitySnapshot["suppressions"],
  };
  return evaluateChannelCampaignEligibility(snapshot, new Date(), input.maximumActions);
}
