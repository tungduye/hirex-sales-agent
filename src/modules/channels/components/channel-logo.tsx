import { Mail } from "lucide-react";
import type { ChannelType } from "../core/channel-contracts";

// Small channel marks for filters and labels. The Zalo and Facebook marks are the ones Deplao already
// uses (deplao-hirex-fork, src/ui/components/common/ChannelBadge.tsx); email uses a plain envelope.
export function ChannelLogo({ channel, size = 14, className = "" }: { channel: ChannelType; size?: number; className?: string }) {
  if (channel === "ZALO") return <svg width={size} height={size} viewBox="0 0 80 80" fill="none" aria-hidden="true" className={`shrink-0 ${className}`}>
    <path d="M80,18v44c0,5-2,9.5-5.3,12.8C71.4,78,66.9,80,62,80H18C8.1,80,0,71.9,0,62V18C0,8.1,8.1,0,18,0h44C71.9,0,80,8.1,80,18z" fill="#2B6AFF"/>
    <path d="M80,18v44c0,5-2,9.5-5.3,12.8H33c-9.9,0-18-8.1-18-18V13.9C15,8.3,17.6,3.3,21.6,0H62C71.9,0,80,8.1,80,18z" fill="#FFFFFF"/>
    <path d="M37.5,58l23.1-33.3v-0.3h-21v-9.1h35.2v6.3L52.2,54.5v0.3h23v9.1H37.5V58z" fill="#2B6AFF"/>
  </svg>;
  // Facebook personal accounts chat through Messenger: its mark (public/brand/messenger.png, provided by the team).
  // eslint-disable-next-line @next/next/no-img-element
  if (channel === "FACEBOOK_PROFILE") return <img src="/brand/messenger.png" alt="" aria-hidden="true" width={size} height={size} className={`shrink-0 ${className}`}/>;
  if (channel === "FACEBOOK") return <span aria-hidden="true" style={{ width: size, height: size }}
    className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#1877F2] ${className}`}>
    <svg width={Math.round(size * 0.78)} height={Math.round(size * 0.78)} viewBox="0 0 24 24">
      <path fill="#FFFFFF" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  </span>;
  if (channel === "EMAIL") return <span aria-hidden="true" style={{ width: size, height: size }} className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-600 ${className}`}>
    <Mail className="text-white" style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62) }} strokeWidth={2.5}/>
  </span>;
  return null;
}
