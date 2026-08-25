export const CHANNEL_TYPES = [
  "EMAIL", "PHONE", "FACEBOOK", "WHATSAPP", "ZALO", "VIBER", "LINKEDIN", "OTHER",
] as const;

export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface ContactChannel {
  id: string;
  channelType: ChannelType;
  channelValue: string;
  isPrimary: boolean;
  createdAt: string;
}
