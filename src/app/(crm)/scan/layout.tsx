import Link from "next/link";
import { FileScan, Globe2 } from "lucide-react";
import { hasPermission } from "@/modules/access/server/access-control";

export default async function ScanLayout({children}:{children:React.ReactNode}){
  const [canCv,canWebsite]=await Promise.all([hasPermission("scan.cv"),hasPermission("scan.website")]);
  return <div className="space-y-6"><nav aria-label="Loại công cụ Scan" className="inline-flex flex-wrap gap-1 rounded-2xl border bg-white p-1.5 shadow-sm">
    {canCv?<Link href="/scan/cv" className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-blue-600 hover:bg-blue-50"><FileScan className="size-4"/>Scan CV</Link>:null}
    {canWebsite?<Link href="/scan/website" className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold text-blue-600 hover:bg-blue-50"><Globe2 className="size-4"/>Scan Website</Link>:null}
  </nav>{children}</div>;
}
