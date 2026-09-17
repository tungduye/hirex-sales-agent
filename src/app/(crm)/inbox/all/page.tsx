import { EmptyConversationSelection, OmnichannelInboxView } from "@/modules/inbox/components/omnichannel-inbox-view";
import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { listQuickReplies } from "@/modules/channels/server/list-quick-replies";

export default async function OmnichannelInboxPage({ searchParams }: { searchParams: Promise<{ channel?: string | string[]; account?: string | string[]; page?: string | string[] }> }) {
  const filters = await searchParams;
  const channel = typeof filters.channel === "string" ? filters.channel : undefined;
  const account = typeof filters.account === "string" ? filters.account : undefined;
  const page = typeof filters.page === "string" ? filters.page : undefined;
  const [data, quickReplies] = await Promise.all([getOmnichannelInboxData({ channelType: channel, accountId: account, page }), listQuickReplies()]);
  return <OmnichannelInboxView {...data} quickReplies={quickReplies.templates} selectedConversationId={null} detail={<EmptyConversationSelection/>}/>;
}
