import { OmnichannelInboxView } from "@/modules/inbox/components/omnichannel-inbox-view";
import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";

export default async function OmnichannelInboxPage({ searchParams }: { searchParams: Promise<{ channel?: string; account?: string }> }) {
  const filters = await searchParams;
  return <OmnichannelInboxView {...await getOmnichannelInboxData({ channelType: filters.channel, accountId: filters.account })}/>;
}
