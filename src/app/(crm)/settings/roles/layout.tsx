import type { ReactNode } from "react";
import { PermissionPage } from "@/modules/access/server/permission-page";

export default function RolesLayout({ children }: { children: ReactNode }) {
  return <PermissionPage permission="roles.view">{children}</PermissionPage>;
}
