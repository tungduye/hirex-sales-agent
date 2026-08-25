import { InboxView } from "@/modules/inbox/components/inbox-view";
import { ThreadDetail } from "@/modules/inbox/components/thread-detail";
import { getInboxData } from "@/modules/inbox/server/get-inbox-data";
import { getThreadDetail } from "@/modules/inbox/server/get-thread-detail";

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
  const detail = data.error
    ? { status: "error" as const, messages: [] as [] }
    : await getThreadDetail(threadId, data.selectedAccountId);
  return <InboxView {...data} selectedThreadId={threadId} detail={<ThreadDetail result={detail} />} />;
}
