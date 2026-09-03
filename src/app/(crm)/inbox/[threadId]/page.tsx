import { InboxView } from "@/modules/inbox/components/inbox-view";
import { ThreadDetail } from "@/modules/inbox/components/thread-detail";
import { getInboxData } from "@/modules/inbox/server/get-inbox-data";
import { getThreadDetail } from "@/modules/inbox/server/get-thread-detail";
import { resolveLatestReplyTargetForThread } from "@/modules/inbox/server/resolve-latest-reply-target";

export default async function InboxThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ account?: string | string[] }>;
}) {
  const [{ threadId }, query] = await Promise.all([params, searchParams]);
  const requestedAccountId = typeof query.account === "string" ? query.account : undefined;
  const data = await getInboxData(requestedAccountId);
  const selectedThread = data.threads.find((thread) => thread.id === threadId);
  const detail = data.error
    ? { status: "error" as const, messages: [] as [] }
    : await getThreadDetail(threadId, data.selectedAccountId);
  const replyContext = selectedThread
    ? await resolveLatestReplyTargetForThread(threadId, selectedThread.emailAccountId)
    : { status: "UNAVAILABLE" as const, emailAccountId: null, emailMessageId: null, message: "Reply is unavailable." };
  return <InboxView {...data} selectedThreadId={threadId} detail={<ThreadDetail result={detail} replyContext={replyContext} threadId={threadId} />} />;
}
