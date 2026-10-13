import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const account = await getAccountContext();

  if (!account) {
    redirect("/login");
  }

  const workspaceAdmin = await isWorkspaceAdmin();
  return <AppShell account={account} workspaceAdmin={workspaceAdmin}>{children}</AppShell>;
}
