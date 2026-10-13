"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Building2, CheckSquare, ContactRound, FileScan, Inbox, LayoutDashboard, Megaphone, Settings, Sparkles, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/modules/identity/components/sign-out-button";
import type { AccountContext } from "@/types/account";

const navigation = [
  { label: "Tổng quan", href: "/", icon: LayoutDashboard, permission:"dashboard.view" },
  { label: "Công ty", href: "/companies", icon: Building2, permission:"companies.view" },
  { label: "Liên hệ", href: "/contacts", icon: ContactRound, permission:"contacts.view" },
  { label: "Hồ Chứa", href: "/inbox", icon: Inbox, permission:"inbox.view" },
  { label: "Scan", href: "/scan", icon: FileScan, permission:"scan.view" },
  { label: "Chiến dịch", href: "/campaigns", icon: Megaphone, permission:"campaigns.view" },
  { label: "Công việc", href: "/tasks", icon: CheckSquare, permission:"tasks.view" },
  { label: "Phân tích", href: "/analytics", icon: BarChart3, permission:"analytics.view" },
  { label: "Tự động hoá", href: "/settings/automation", icon: Workflow, permission:"roles.manage" },
  { label: "AI Recruiter", href: "/settings/ai-recruiter", icon: Bot, permission:"roles.manage" },
  { label: "Tài liệu", href: "/documents", icon: FileScan, permission:"roles.manage" },
  { label: "Cài đặt", href: "/settings", icon: Settings, permission:"settings.view" },
];

export function Sidebar({ account, workspaceAdmin, onNavigate }: { account: AccountContext; workspaceAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 flex w-[264px] flex-col border-r border-slate-800 bg-slate-950 text-slate-300">
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white"><Sparkles className="size-5" /></div>
        <div>
          <div className="text-sm font-bold tracking-tight text-white">HireX Sales Agent</div>
          <div className="text-[11px] text-slate-500">Không gian CRM</div>
        </div>
      </div>
      <nav className="flex-1 space-y-1 p-3" aria-label="Điều hướng chính">
        {navigation.filter(item => account.permissions.includes(item.permission) && (!item.href.startsWith("/settings/ai-recruiter") && item.href !== "/settings/automation" && item.href !== "/documents" || workspaceAdmin)).map((item) => {
          const active = item.href === "/" ? pathname === "/" : item.href === "/settings" ? pathname.startsWith("/settings") && !pathname.startsWith("/settings/automation") : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors", active ? "bg-blue-600 text-white shadow-sm" : "hover:bg-slate-900 hover:text-white")}>
              <item.icon className="size-[18px]" />{item.label}
            </Link>
          );
        })}
      </nav>
      <div className="m-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-2"><div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{(account.fullName ?? account.email).slice(0, 2).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{account.fullName ?? "Đang thiết lập tài khoản"}</p><p className="truncate text-[11px] text-slate-400">{account.email}</p></div></div>
        {account.workspaceName && <p className="mt-2 truncate border-t border-slate-800 pt-2 text-[11px] text-slate-500">{account.workspaceName}</p>}
        <SignOutButton />
      </div>
    </aside>
  );
}
