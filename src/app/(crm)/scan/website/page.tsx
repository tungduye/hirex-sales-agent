import { WebsiteScanWorkspace } from "@/modules/website-scan/components/website-scan-workspace";
import { PermissionPage } from "@/modules/access/server/permission-page";
import { hasPermission } from "@/modules/access/server/access-control";

export default async function ScanWebsitePage() { const canExport=await hasPermission("scan.export");return <PermissionPage permission="scan.website"><WebsiteScanWorkspace canExport={canExport}/></PermissionPage>; }
