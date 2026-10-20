import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { BroadcastList } from "@/modules/broadcasts/components/broadcast-views";
import { listBroadcasts } from "@/modules/broadcasts/server/broadcast-data";

export const metadata = { title: "Gửi nhóm Zalo" };

export default async function BroadcastsPage() {
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const isAdmin = await isWorkspaceAdmin();
  const context = { workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin };
  return <BroadcastList items={await listBroadcasts(context)} canCreate={isAdmin || account.permissions.includes("broadcasts.manage")}/>;
}
