import type { ReactNode } from "react";
import Link from "next/link";
import { Mail, MessageCircle, MessageSquareMore as Facebook } from "lucide-react";
import { PermissionPage } from "@/modules/access/server/permission-page";

export default function Layout({ children }: { children: ReactNode }) {
  return <PermissionPage permission="campaigns.view"><nav aria-label="Loại chiến dịch" className="mb-5 flex w-fit flex-wrap gap-1 rounded-xl border bg-white p-1 shadow-sm"><Link href="/campaigns" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"><Mail className="size-4" />Email Marketing</Link><Link href="/campaigns/omnichannel" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"><MessageCircle className="size-4" />Zalo Marketing</Link><Link href="/campaigns/facebook-profile" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Facebook className="size-4"/>Facebook cá nhân</Link></nav>{children}</PermissionPage>;
}
