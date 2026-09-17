import { redirect } from "next/navigation";

export default async function InboxThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ account?: string | string[] }>;
}) {
  const [{ threadId }, query] = await Promise.all([params, searchParams]);
  const account = typeof query.account === "string" ? `&account=${encodeURIComponent(query.account)}` : "";
  redirect(`/inbox/all/${encodeURIComponent(threadId)}?channel=EMAIL${account}`);
}
