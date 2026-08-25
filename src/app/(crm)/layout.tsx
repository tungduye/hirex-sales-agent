import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const account = await getAccountContext();

  if (!account) {
    redirect("/login");
  }

  return <AppShell account={account}>{children}</AppShell>;
}
