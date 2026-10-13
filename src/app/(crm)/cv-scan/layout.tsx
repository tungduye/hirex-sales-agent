import type { ReactNode } from "react";
import { PermissionPage } from "@/modules/access/server/permission-page";

export default function CvScanLayout({ children }: { children: ReactNode }) {
  return <PermissionPage permission="scan.cv">{children}</PermissionPage>;
}
