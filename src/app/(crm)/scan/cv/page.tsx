import { CvScanWorkspace } from "@/modules/cv-scan/components/cv-scan-workspace";
import { PermissionPage } from "@/modules/access/server/permission-page";

export default function ScanCvPage() { return <PermissionPage permission="scan.cv"><CvScanWorkspace /></PermissionPage>; }
