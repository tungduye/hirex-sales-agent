import type { ChannelType } from "../core/channel-contracts";

export interface QuickReplyTemplate {
  id: string;
  name: string;
  shortcut: string;
  textContent: string;
  channelTypes: ChannelType[];
}
