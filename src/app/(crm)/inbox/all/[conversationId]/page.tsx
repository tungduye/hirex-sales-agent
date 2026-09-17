import { OmnichannelConversationDetail } from "@/modules/inbox/components/omnichannel-conversation-detail";
import { OmnichannelInboxView } from "@/modules/inbox/components/omnichannel-inbox-view";
import { ThreadDetail } from "@/modules/inbox/components/thread-detail";
import { listQuickReplies } from "@/modules/channels/server/list-quick-replies";
import { getOmnichannelConversationDetail } from "@/modules/inbox/server/get-omnichannel-conversation-detail";
import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { getThreadDetail } from "@/modules/inbox/server/get-thread-detail";
import { resolveLatestReplyTargetForThread } from "@/modules/inbox/server/resolve-latest-reply-target";

export default async function OmnichannelConversationPage({ params, searchParams }: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ channel?: string | string[]; account?: string | string[]; page?: string | string[] }>;
}) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);
  const channel = typeof query.channel === "string" ? query.channel : undefined;
  const account = typeof query.account === "string" ? query.account : undefined;
  const page = typeof query.page === "string" ? query.page : undefined;
  const [data, detailResult, quickReplies] = await Promise.all([
    getOmnichannelInboxData({ channelType: channel, accountId: account, page }),
    getOmnichannelConversationDetail(conversationId),
    listQuickReplies(),
  ]);
  let emailDetail = null;
  if (detailResult.status === "ready" && detailResult.conversation.channelType === "EMAIL" && detailResult.conversation.legacyEmailAccountId) {
    const emailAccountId = detailResult.conversation.legacyEmailAccountId;
    const [threadResult, replyContext] = await Promise.all([
      getThreadDetail(conversationId, emailAccountId),
      resolveLatestReplyTargetForThread(conversationId, emailAccountId),
    ]);
    emailDetail = <ThreadDetail result={threadResult} replyContext={replyContext} threadId={conversationId}/>;
  }
  const detail = <OmnichannelConversationDetail result={detailResult} profiles={data.profiles} tags={data.tags} quickReplies={quickReplies.templates} emailDetail={emailDetail}/>;
  return <OmnichannelInboxView {...data} quickReplies={quickReplies.templates} selectedConversationId={conversationId} detail={detail}/>;
}
