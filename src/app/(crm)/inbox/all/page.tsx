import { OmnichannelInboxView } from "@/modules/inbox/components/omnichannel-inbox-view";
import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { listQuickReplies } from "@/modules/channels/server/list-quick-replies";

export default async function OmnichannelInboxPage({ searchParams }: { searchParams: Promise<{ channel?: string; account?: string }> }) {
  const filters = await searchParams;
  const[data,quickReplies]=await Promise.all([getOmnichannelInboxData({ channelType: filters.channel, accountId: filters.account }),listQuickReplies()]);
  return <OmnichannelInboxView {...data} quickReplies={quickReplies.templates}/>;
}
