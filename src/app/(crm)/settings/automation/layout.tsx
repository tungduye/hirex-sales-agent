import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { isWorkspaceAdmin } from "@/modules/access/server/access-control";

export default async function AutomationLayout({ children }: { children: ReactNode }) {
  if (!await isWorkspaceAdmin()) redirect("/");
  return children;
}
