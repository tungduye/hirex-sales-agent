import { OmnichannelConversationDetail } from "@/modules/inbox/components/omnichannel-conversation-detail";
import { ThreadDetail } from "@/modules/inbox/components/thread-detail";
import { listQuickReplies } from "@/modules/channels/server/list-quick-replies";
import { getOmnichannelConversationDetail } from "@/modules/inbox/server/get-omnichannel-conversation-detail";
import { getInboxPeopleAndTags } from "@/modules/inbox/server/get-omnichannel-inbox-data";
import { getThreadDetail } from "@/modules/inbox/server/get-thread-detail";
import { resolveLatestReplyTargetForThread } from "@/modules/inbox/server/resolve-latest-reply-target";
import { hasPermission } from "@/modules/access/server/access-control";

// Only the open conversation is rendered here; the list stays in the layout (InboxShell).
export default async function OmnichannelConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const [people, detailResult, quickReplies, canUpdateConversation] = await Promise.all([
    getInboxPeopleAndTags(),
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
  return <OmnichannelConversationDetail result={detailResult} profiles={people.profiles} tags={people.tags} quickReplies={quickReplies.templates} canUpdateConversation={canUpdateConversation} emailDetail={emailDetail}/>;
}
