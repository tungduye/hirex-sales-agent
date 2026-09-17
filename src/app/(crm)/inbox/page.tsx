import { redirect } from "next/navigation";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ account?: string | string[] }> }) {
  const query = await searchParams;
  const requestedAccountId = typeof query.account === "string" ? query.account : undefined;
  const suffix = requestedAccountId ? `?channel=EMAIL&account=${encodeURIComponent(requestedAccountId)}` : "";
  redirect(`/inbox/all${suffix}`);
}
