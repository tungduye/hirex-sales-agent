import type { ReactNode } from "react";
import { PermissionPage } from "@/modules/access/server/permission-page";

export default function ChannelsLayout({ children }: { children: ReactNode }) {
  return <PermissionPage permission="channels.view">{children}</PermissionPage>;
}
