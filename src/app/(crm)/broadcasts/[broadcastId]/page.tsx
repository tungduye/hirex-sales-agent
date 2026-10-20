import { notFound } from "next/navigation";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { BroadcastDetail } from "@/modules/broadcasts/components/broadcast-views";
import { broadcastTargets, listBroadcasts } from "@/modules/broadcasts/server/broadcast-data";

export const metadata = { title: "Đợt gửi nhóm Zalo" };

export default async function BroadcastPage({ params }: { params: Promise<{ broadcastId: string }> }) {
  const { broadcastId } = await params;
  const account = await getAccountContext();
  if (!account?.workspaceId || !/^[0-9a-f-]{36}$/iu.test(broadcastId)) notFound();
  const context = { workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin: await isWorkspaceAdmin() };
  const [item] = await listBroadcasts(context, broadcastId);
  if (!item) notFound();
  return <BroadcastDetail item={item} targets={await broadcastTargets(context, broadcastId)}/>;
}
