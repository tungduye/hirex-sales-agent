import { OmnichannelConversationDetail } from "@/modules/inbox/components/omnichannel-conversation-detail";
import { OmnichannelInboxView } from "@/modules/inbox/components/omnichannel-inbox-view";
import { ThreadDetail } from "@/modules/inbox/components/thread-detail";
import { listQuickReplies } from "@/modules/channels/server/list-quick-replies";
import { getOmnichannelConversationDetail } from "@/modules/inbox/server/get-omnichannel-conversation-detail";
import { getOmnichannelInboxData } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { getThreadDetail } from "@/modules/inbox/server/get-thread-detail";
import { resolveLatestReplyTargetForThread } from "@/modules/inbox/server/resolve-latest-reply-target";
import { hasPermission } from "@/modules/access/server/access-control";

export default async function OmnichannelConversationPage({ params, searchParams }: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ channel?: string | string[]; account?: string | string[]; owner?: string | string[]; page?: string | string[]; tag?: string | string[]; tagMode?: string | string[]; firstFrom?: string | string[]; firstTo?: string | string[] }>;
}) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);
  const channel = query.channel;
  const account = typeof query.account === "string" ? query.account : undefined;
  const ownerIds = Array.isArray(query.owner) ? query.owner : typeof query.owner === "string" ? [query.owner] : [];
  const page = typeof query.page === "string" ? query.page : undefined;
  const tagIds = Array.isArray(query.tag) ? query.tag : typeof query.tag === "string" ? [query.tag] : [];
  const tagMatchMode = typeof query.tagMode === "string" ? query.tagMode : undefined;
  const firstMessageFrom = typeof query.firstFrom === "string" ? query.firstFrom : undefined;
  const firstMessageTo = typeof query.firstTo === "string" ? query.firstTo : undefined;
  const [data, detailResult, quickReplies, canUpdateConversation] = await Promise.all([
    getOmnichannelInboxData({ channelType: channel, accountId: account, ownerIds, page, tagIds, tagMatchMode, firstMessageFrom, firstMessageTo }),
    getOmnichannelConversationDetail(conversationId),
    listQuickReplies(),
    hasPermission("inbox.update"),
  ]);
  let emailDetail = null;
  if (detailResult.status === "ready" && detailResult.conversation.channelType === "EMAIL" && detailResult.conversation.legacyEmailAccountId && detailResult.conversation.legacyEmailThreadId) {
    const emailAccountId = detailResult.conversation.legacyEmailAccountId;
    const emailThreadId = detailResult.conversation.legacyEmailThreadId;
    const [threadResult, replyContext] = await Promise.all([
      getThreadDetail(emailThreadId, emailAccountId),
      resolveLatestReplyTargetForThread(emailThreadId, emailAccountId),
    ]);
    emailDetail = <ThreadDetail result={threadResult} replyContext={replyContext} threadId={emailThreadId}/>;
  }
  const detail = <OmnichannelConversationDetail result={detailResult} profiles={data.profiles} tags={data.tags} quickReplies={quickReplies.templates} canUpdateConversation={canUpdateConversation} emailDetail={emailDetail}/>;
  return <OmnichannelInboxView {...data} quickReplies={quickReplies.templates} selectedConversationId={conversationId} detail={detail}/>;
}
