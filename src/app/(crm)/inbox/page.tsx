import { InboxView, SelectThreadPrompt } from "@/modules/inbox/components/inbox-view";
import { getInboxData } from "@/modules/inbox/server/get-inbox-data";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ account?: string | string[] }> }) {
  const query = await searchParams;
  const requestedAccountId = typeof query.account === "string" ? query.account : undefined;
  const data = await getInboxData(requestedAccountId);
  return <InboxView {...data} selectedThreadId={null} detail={<SelectThreadPrompt />} />;
}
