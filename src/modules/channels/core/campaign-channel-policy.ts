import type { ChannelCapability, ChannelType } from "./channel-contracts.ts";

export interface CampaignChannelCandidate {
  channelAccountId: string;
  channelType: ChannelType;
  recipientExternalId: string;
  connected: boolean;
  suppressed: boolean;
  optedOut: boolean;
  capabilities: ReadonlySet<ChannelCapability>;
  priority: number;
}

export interface CampaignMessageRequirement {
  needsText: boolean;
  needsFiles: boolean;
  needsTemplates: boolean;
}

function supports(candidate: CampaignChannelCandidate, requirements: CampaignMessageRequirement): boolean {
  return (
    (!requirements.needsText || candidate.capabilities.has("SEND_TEXT")) &&
    (!requirements.needsFiles || candidate.capabilities.has("SEND_FILE")) &&
    (!requirements.needsTemplates || candidate.capabilities.has("TEMPLATES"))
  );
}

export function selectCampaignChannel(
  candidates: readonly CampaignChannelCandidate[],
  requirements: CampaignMessageRequirement,
): CampaignChannelCandidate | null {
  return (
    candidates
      .filter((candidate) =>
        candidate.connected &&
        !candidate.suppressed &&
        !candidate.optedOut &&
        candidate.recipientExternalId.trim().length > 0 &&
        supports(candidate, requirements),
      )
      .sort((left, right) => left.priority - right.priority || left.channelAccountId.localeCompare(right.channelAccountId))[0] ?? null
  );
}
