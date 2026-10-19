import type { ChannelType } from "../core/channel-contracts";

// Small channel marks for filters and labels: the logo images the team provided (public/brand/*.png).
const LOGOS: Partial<Record<ChannelType, string>> = {
  ZALO: "/brand/zalo.png",
  FACEBOOK: "/brand/facebook.png",
  FACEBOOK_PROFILE: "/brand/messenger.png",
  EMAIL: "/brand/email.png",
};

export function ChannelLogo({ channel, size = 14, className = "" }: { channel: ChannelType; size?: number; className?: string }) {
  const src = LOGOS[channel];
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden="true" width={size} height={size} className={`shrink-0 object-contain ${className}`}/>;
}
