export const CHANNEL_TYPES = [
  "EMAIL", "PHONE", "FACEBOOK", "WHATSAPP", "ZALO", "VIBER", "LINKEDIN", "OTHER",
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];
export type MarketingConsentStatus = "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";

export interface ContactChannel {
  id: string;
  channelType: ChannelType;
  channelValue: string;
  isPrimary: boolean;
  marketingConsentStatus: MarketingConsentStatus;
  marketingConsentSource: string | null;
  marketingConsentRecordedAt: string | null;
  createdAt: string;
}
