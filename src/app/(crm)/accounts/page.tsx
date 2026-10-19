import { ExternalLink, KeyRound } from "lucide-react";
import { hasPermission } from "@/modules/access/server/access-control";

// "Tài khoản": the team's account manager (server-ahs.hat11.io.vn) shown inside HireX, so people stay in
// the HireX tab. Only members whose role has "Tài khoản · Xem" see the menu item and this page.
const ACCOUNTS_SITE = "https://server-ahs.hat11.io.vn/";

export const metadata = { title: "Tài khoản" };

export default async function AccountsPage() {
  if (!await hasPermission("accounts.view")) {
    return <div className="m-6 rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-600">
      <KeyRound className="mx-auto mb-3 size-8 text-slate-400"/>Tài khoản của bạn chưa được cấp quyền xem mục Tài khoản.
    </div>;
  }
  return <div className="flex h-[calc(100dvh-4rem)] flex-col bg-white">
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-200 px-4 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><KeyRound className="size-3.5"/>Tài khoản</span>
      <a href={ACCOUNTS_SITE} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline">Mở trong tab mới<ExternalLink className="size-3"/></a>
    </div>
    <iframe src={ACCOUNTS_SITE} title="Tài khoản" className="min-h-0 w-full flex-1 border-0" allow="clipboard-read; clipboard-write" referrerPolicy="strict-origin-when-cross-origin"/>
  </div>;
}
