import { redirect } from "next/navigation";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { BroadcastForm } from "@/modules/broadcasts/components/broadcast-form";
import { broadcastNicks } from "@/modules/broadcasts/server/broadcast-data";

export const metadata = { title: "Tạo đợt gửi nhóm Zalo" };

export default async function NewBroadcastPage() {
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const isAdmin = await isWorkspaceAdmin();
  if (!isAdmin && !account.permissions.includes("broadcasts.manage")) redirect("/broadcasts");
  const context = { workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin };
  return <BroadcastForm nicks={await broadcastNicks(context)}/>;
}
