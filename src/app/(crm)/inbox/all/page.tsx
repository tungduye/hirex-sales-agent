import { EmptyConversationSelection, OmnichannelInboxView } from "@/modules/inbox/components/omnichannel-inbox-view";
import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { listQuickReplies } from "@/modules/channels/server/list-quick-replies";

export default async function OmnichannelInboxPage({ searchParams }: { searchParams: Promise<{ channel?: string | string[]; account?: string | string[]; owner?: string | string[]; page?: string | string[]; tag?: string | string[]; tagMode?: string | string[]; firstFrom?: string | string[]; firstTo?: string | string[] }> }) {
  const filters = await searchParams;
  const channel = typeof filters.channel === "string" ? filters.channel : undefined;
  const account = typeof filters.account === "string" ? filters.account : undefined;
  const ownerIds = Array.isArray(filters.owner) ? filters.owner : typeof filters.owner === "string" ? [filters.owner] : [];
  const page = typeof filters.page === "string" ? filters.page : undefined;
  const tagIds = Array.isArray(filters.tag) ? filters.tag : typeof filters.tag === "string" ? [filters.tag] : [];
  const tagMatchMode = typeof filters.tagMode === "string" ? filters.tagMode : undefined;
  const firstMessageFrom = typeof filters.firstFrom === "string" ? filters.firstFrom : undefined;
  const firstMessageTo = typeof filters.firstTo === "string" ? filters.firstTo : undefined;
  const [data, quickReplies] = await Promise.all([getOmnichannelInboxData({ channelType: channel, accountId: account, ownerIds, page, tagIds, tagMatchMode, firstMessageFrom, firstMessageTo }), listQuickReplies()]);
  return <OmnichannelInboxView {...data} quickReplies={quickReplies.templates} selectedConversationId={null} detail={<EmptyConversationSelection/>}/>;
}
