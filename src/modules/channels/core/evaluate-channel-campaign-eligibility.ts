export type IneligibilityReason =
  | "CAMPAIGN_NOT_SENDABLE" | "NOT_DUE" | "STEP_NOT_PENDING"
  | "NOT_OPTED_IN" | "SUPPRESSED" | "NO_OPEN_CONVERSATION"
  | "RESPONSE_WINDOW_EXPIRED" | "ACCOUNT_MISMATCH"
  | "MISSING_PROVIDER_IDENTITY" | "NO_ENABLED_SENDER";

export interface CampaignEligibilitySnapshot {
  campaign: { id: string; status: string } | null;
  steps: { id: string; position: number; allowed_channels: string[]; text_template: string | null; attachment_ids: string[] }[];
  senders: { channel_account_id: string; priority: number; enabled: boolean }[];
  accounts: { id: string; channel_type: string; status: string; capabilities: string[] }[];
  recipients: { id: string; contact_id: string; status: string; current_step_position: number; next_step_at: string | null }[];
  recipientSteps: { recipient_id: string; step_id: string; status: string }[];
  identities: { contact_id: string; channel_type: string; channel_value: string; marketing_consent_status: string }[];
  conversations: { channel_account_id: string; provider_conversation_id: string; status: string; last_message_at: string | null }[];
  suppressions: { channel_type: string; normalized_recipient: string }[];
}

export interface CampaignEligibilityProjection {
  campaignId: string;
  channel: string | null;
  audienceCount: number;
  eligibleRecipientCount: number;
  ineligibleRecipientCount: number;
  projectedActions: number;
  reasons: Partial<Record<IneligibilityReason, number>>;
}

export function evaluateChannelCampaignEligibility(snapshot: CampaignEligibilitySnapshot, now: Date, maximumActions: number): CampaignEligibilityProjection {
  if (!snapshot.campaign) throw new Error("CHANNEL_CAMPAIGN_NOT_FOUND");
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(maximumActions) || maximumActions < 1 || maximumActions > 25) throw new Error("CHANNEL_CAMPAIGN_INPUT_INVALID");
  const reasons: CampaignEligibilityProjection["reasons"] = {};
  const mark = (reason: IneligibilityReason) => { reasons[reason] = (reasons[reason] ?? 0) + 1; };
  const channels = new Set(snapshot.steps.flatMap((step) => step.allowed_channels));
  const channel = channels.size === 1 ? [...channels][0] : channels.size > 1 ? "MULTICHANNEL" : null;
  let eligible = 0;
  for (const recipient of snapshot.recipients) {
    const campaignStatus = snapshot.campaign.status;
    if (!(["DRAFT", "RUNNING"].includes(campaignStatus)) || recipient.status !== "ACTIVE") { mark("CAMPAIGN_NOT_SENDABLE"); continue; }
    if (campaignStatus === "RUNNING" && (!recipient.next_step_at || !Number.isFinite(Date.parse(recipient.next_step_at)) || Date.parse(recipient.next_step_at) > now.getTime())) { mark("NOT_DUE"); continue; }
    const step = snapshot.steps.find((item) => item.position === recipient.current_step_position);
    if (!step) { mark("STEP_NOT_PENDING"); continue; }
    if (campaignStatus === "RUNNING" && !snapshot.recipientSteps.some((item) => item.recipient_id === recipient.id && item.step_id === step.id && item.status === "PENDING")) { mark("STEP_NOT_PENDING"); continue; }
    const senderAccounts = snapshot.senders.filter((sender) => sender.enabled).sort((a, b) => a.priority - b.priority).map((sender) => snapshot.accounts.find((account) => account.id === sender.channel_account_id)).filter((account) => account !== undefined);
    if (senderAccounts.length === 0) { mark("NO_ENABLED_SENDER"); continue; }
    const identities = snapshot.identities.filter((identity) => identity.contact_id === recipient.contact_id && step.allowed_channels.includes(identity.channel_type));
    if (identities.length === 0 || identities.every((identity) => !identity.channel_value.trim())) { mark("MISSING_PROVIDER_IDENTITY"); continue; }
    if (identities.every((identity) => identity.marketing_consent_status !== "OPTED_IN")) { mark("NOT_OPTED_IN"); continue; }
    const optedIn = identities.filter((identity) => identity.marketing_consent_status === "OPTED_IN" && identity.channel_value.trim());
    const matched = optedIn.flatMap((identity) => senderAccounts.filter((account) => account.status === "CONNECTED" && account.channel_type === identity.channel_type && ["FACEBOOK", "ZALO"].includes(account.channel_type) && (step.text_template === null || account.capabilities.includes("SEND_TEXT")) && (step.attachment_ids.length === 0 || account.capabilities.includes("SEND_FILE"))).map((account) => ({ identity, account })));
    if (matched.length === 0) { mark("ACCOUNT_MISMATCH"); continue; }
    const unsuppressed = matched.filter(({ identity, account }) => !snapshot.suppressions.some((suppression) => suppression.channel_type === account.channel_type && suppression.normalized_recipient.trim().toLowerCase() === identity.channel_value.trim().toLowerCase()));
    if (unsuppressed.length === 0) { mark("SUPPRESSED"); continue; }
    const open = unsuppressed.filter(({ identity, account }) => account.channel_type !== "FACEBOOK" || snapshot.conversations.some((conversation) => conversation.channel_account_id === account.id && conversation.provider_conversation_id === identity.channel_value && ["OPEN", "PENDING"].includes(conversation.status)));
    if (open.length === 0) { mark("NO_OPEN_CONVERSATION"); continue; }
    const withinWindow = open.some(({ identity, account }) => account.channel_type !== "FACEBOOK" || snapshot.conversations.some((conversation) => conversation.channel_account_id === account.id && conversation.provider_conversation_id === identity.channel_value && ["OPEN", "PENDING"].includes(conversation.status) && conversation.last_message_at !== null && Number.isFinite(Date.parse(conversation.last_message_at)) && Date.parse(conversation.last_message_at) >= now.getTime() - 23 * 60 * 60 * 1000));
    if (!withinWindow) { mark("RESPONSE_WINDOW_EXPIRED"); continue; }
    eligible += 1;
  }
  return { campaignId: snapshot.campaign.id, channel, audienceCount: snapshot.recipients.length, eligibleRecipientCount: eligible, ineligibleRecipientCount: snapshot.recipients.length - eligible, projectedActions: Math.min(eligible, maximumActions), reasons };
}
