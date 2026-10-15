"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, Building2, CheckSquare, ContactRound, FileScan, FileText, Inbox, LayoutDashboard, Megaphone, PanelLeftClose, PanelLeftOpen, Settings, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeNavigationHref } from "./navigation";
import { SignOutButton } from "@/modules/identity/components/sign-out-button";
import type { AccountContext } from "@/types/account";

const navigation = [
  { label: "Tổng quan", href: "/", icon: LayoutDashboard, permission:"dashboard.view" },
  { label: "Công ty", href: "/companies", icon: Building2, permission:"companies.view" },
  { label: "Liên hệ", href: "/contacts", icon: ContactRound, permission:"contacts.view" },
  { label: "Hồ Chứa", href: "/inbox", icon: Inbox, permission:"inbox.view" },
  { label: "Scan", href: "/scan", icon: FileScan, permission:"scan.view" },
  { label: "Chiến dịch", href: "/campaigns", icon: Megaphone, permission:"campaigns.view" },
  { label: "Kho content", href: "/content", icon: FileText, permission:"content.view" },
  { label: "Công việc", href: "/tasks", icon: CheckSquare, permission:"tasks.view" },
  { label: "Phân tích", href: "/analytics", icon: BarChart3, permission:"analytics.view" },
  { label: "Tự động hoá", href: "/settings/automation", icon: Workflow, permission:"roles.manage" },
  { label: "AI Recruiter", href: "/settings/ai-recruiter", icon: Bot, permission:"roles.manage" },
  { label: "Tài liệu", href: "/documents", icon: FileScan, permission:"roles.manage" },
  { label: "Cài đặt", href: "/settings", icon: Settings, permission:"settings.view" },
];

/** collapsed: icon-only column (desktop); onToggleCollapsed shows the "Thu gọn / Mở rộng menu" button. */
export function Sidebar({ account, workspaceAdmin, onNavigate, collapsed = false, onToggleCollapsed }: { account: AccountContext; workspaceAdmin: boolean; onNavigate?: () => void; collapsed?: boolean; onToggleCollapsed?: () => void }) {
  const pathname = usePathname();
  const visible = navigation.filter(item => account.permissions.includes(item.permission) && (!item.href.startsWith("/settings/ai-recruiter") && item.href !== "/settings/automation" && item.href !== "/documents" || workspaceAdmin));
  const activeHref = activeNavigationHref(pathname, visible.map(item => item.href));

  return (
    <aside className={cn("fixed inset-y-0 z-40 flex flex-col border-r border-slate-800 bg-slate-950 text-slate-300", collapsed ? "w-[72px]" : "w-[264px]")}>
      <div className={cn("flex h-16 items-center gap-3 border-b border-slate-800", collapsed ? "justify-center px-0" : "px-5")}>
        <Image src="/brand/intalent-mark.png" alt="Intalent Viet Nam" width={36} height={36} unoptimized priority className="size-9 shrink-0 object-contain" />
        {collapsed ? null : <div>
          <div className="text-sm font-bold tracking-tight text-white">Intalent Viet Nam</div>
          <div className="text-[11px] text-slate-500">Không gian CRM</div>
        </div>}
      </div>
      <nav className={cn("flex-1 space-y-1 overflow-y-auto", collapsed ? "p-2" : "p-3")} aria-label="Điều hướng chính">
        {visible.map((item) => {
          const active = item.href === activeHref;
          return (
            <Link key={item.href} href={item.href} onClick={onNavigate} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} className={cn("flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors", collapsed ? "justify-center px-0" : "px-3", active ? "bg-blue-600 text-white shadow-sm" : "hover:bg-slate-900 hover:text-white")}>
              <item.icon className="size-[18px] shrink-0" />{collapsed ? null : item.label}
            </Link>
          );
        })}
      </nav>
      {onToggleCollapsed ? <button type="button" onClick={onToggleCollapsed} aria-expanded={!collapsed} title={collapsed ? "Mở rộng menu" : "Thu gọn menu"} className={cn("mx-3 mb-1 flex items-center gap-3 rounded-lg py-2 text-sm font-medium text-slate-400 hover:bg-slate-900 hover:text-white", collapsed ? "mx-2 justify-center px-0" : "px-3")}>{collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}{collapsed ? <span className="sr-only">Mở rộng menu</span> : "Thu gọn menu"}</button> : null}
      {collapsed ? <div className="m-2 flex justify-center border-t border-slate-800 pt-3"><div className="flex size-9 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white" title={`${account.fullName ?? account.email}`}>{(account.fullName ?? account.email).slice(0, 2).toUpperCase()}</div></div> : <div className="m-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-2"><div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{(account.fullName ?? account.email).slice(0, 2).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{account.fullName ?? "Đang thiết lập tài khoản"}</p><p className="truncate text-[11px] text-slate-400">{account.email}</p></div></div>
        {account.workspaceName && <p className="mt-2 truncate border-t border-slate-800 pt-2 text-[11px] text-slate-500">{account.workspaceName}</p>}
        <SignOutButton />
      </div>}
    </aside>
  );
}
