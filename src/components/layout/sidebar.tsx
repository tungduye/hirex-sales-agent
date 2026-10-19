"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Bot, Building2, CheckSquare, ChevronRight, ContactRound, FileScan, FileText, Inbox, KeyRound, LayoutDashboard, Megaphone, PanelLeftClose, PanelLeftOpen, Settings, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeNavigationHref } from "./navigation";
import { SignOutButton } from "@/modules/identity/components/sign-out-button";
import type { AccountContext } from "@/types/account";

type NavItem = { label: string; href: string; icon: typeof LayoutDashboard; permission: string; adminOnly?: boolean };

/** Main menu. */
const navigation: NavItem[] = [
  { label: "Tổng quan", href: "/", icon: LayoutDashboard, permission:"dashboard.view" },
  { label: "Suối Nguồn", href: "/inbox", icon: Inbox, permission:"inbox.view" },
  { label: "Scan", href: "/scan", icon: FileScan, permission:"scan.view" },
  { label: "Chiến dịch", href: "/campaigns", icon: Megaphone, permission:"campaigns.view" },
  { label: "Kho content", href: "/content", icon: FileText, permission:"content.view" },
  { label: "Tài liệu", href: "/documents", icon: FileScan, permission:"roles.manage", adminOnly: true },
  { label: "Tài khoản", href: "/accounts", icon: KeyRound, permission:"accounts.view" },
];

/** Shown when hovering (or clicking) "Cài đặt". */
const settingsNavigation: NavItem[] = [
  { label: "Cài đặt chung", href: "/settings", icon: Settings, permission:"settings.view" },
  { label: "Công ty", href: "/companies", icon: Building2, permission:"companies.view" },
  { label: "Liên hệ", href: "/contacts", icon: ContactRound, permission:"contacts.view" },
  { label: "Công việc", href: "/tasks", icon: CheckSquare, permission:"tasks.view" },
  { label: "Phân tích", href: "/analytics", icon: BarChart3, permission:"analytics.view" },
  { label: "Tự động hoá", href: "/settings/automation", icon: Workflow, permission:"roles.manage", adminOnly: true },
  { label: "AI Recruiter", href: "/settings/ai-recruiter", icon: Bot, permission:"roles.manage", adminOnly: true },
];

/** collapsed: icon-only column (desktop); onToggleCollapsed shows the "Thu gọn / Mở rộng menu" button. */
export function Sidebar({ account, workspaceAdmin, onNavigate, collapsed = false, onToggleCollapsed }: { account: AccountContext; workspaceAdmin: boolean; onNavigate?: () => void; collapsed?: boolean; onToggleCollapsed?: () => void }) {
  const pathname = usePathname();
  const allowed = (item: NavItem) => account.permissions.includes(item.permission) && (!item.adminOnly || workspaceAdmin);
  const visible = navigation.filter(allowed);
  const settingsItems = settingsNavigation.filter(allowed);
  const activeHref = activeNavigationHref(pathname, [...visible, ...settingsItems].map(item => item.href));
  const settingsActive = settingsItems.some((item) => item.href === activeHref);
  // Desktop: a menu that opens beside the sidebar on hover/click. Mobile drawer: expands in place.
  const inline = Boolean(onNavigate);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flyoutTop, setFlyoutTop] = useState(0);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const openSettings = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    const rect = settingsRef.current?.getBoundingClientRect();
    if (rect) setFlyoutTop(Math.max(8, Math.min(rect.top, window.innerHeight - (settingsItems.length * 40 + 56))));
    setSettingsOpen(true);
  };
  const closeSettingsSoon = () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setSettingsOpen(false), 150); };
  useEffect(() => { setSettingsOpen(false); }, [pathname]);
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen]);
  const itemClass = (active: boolean) => cn("flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors", collapsed ? "justify-center px-0" : "px-3", active ? "bg-blue-600 text-white shadow-sm" : "hover:bg-slate-900 hover:text-white");

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
            <Link prefetch={false} key={item.href} href={item.href} onClick={onNavigate} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} className={cn("flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-colors", collapsed ? "justify-center px-0" : "px-3", active ? "bg-blue-600 text-white shadow-sm" : "hover:bg-slate-900 hover:text-white")}>
              <item.icon className="size-[18px] shrink-0" />{collapsed ? null : item.label}
            </Link>
          );
        })}
        {settingsItems.length > 0 && <>
          <button ref={settingsRef} type="button" aria-haspopup="menu" aria-expanded={settingsOpen}
            onMouseEnter={inline ? undefined : openSettings} onMouseLeave={inline ? undefined : closeSettingsSoon}
            onClick={() => settingsOpen ? setSettingsOpen(false) : openSettings()}
            title={collapsed ? "Cài đặt" : undefined} aria-label={collapsed ? "Cài đặt" : undefined}
            className={cn(itemClass(settingsActive && !settingsOpen), "w-full", settingsOpen && "bg-slate-900 text-white")}>
            <Settings className="size-[18px] shrink-0" />{collapsed ? null : <><span className="flex-1 text-left">Cài đặt</span><ChevronRight className={cn("size-4 text-slate-500 transition-transform", inline && settingsOpen && "rotate-90")} /></>}
          </button>
          {settingsOpen && inline && <div className="space-y-1 pl-4" role="menu">
            {settingsItems.map((item) => <Link prefetch={false} key={item.href} href={item.href} role="menuitem" onClick={onNavigate} className={itemClass(item.href === activeHref)}><item.icon className="size-[18px] shrink-0" />{item.label}</Link>)}
          </div>}
        </>}
      </nav>
      {settingsOpen && !inline && <div role="menu" aria-label="Cài đặt" onMouseEnter={openSettings} onMouseLeave={closeSettingsSoon}
        className="fixed z-50 w-56 rounded-xl border border-slate-800 bg-slate-950 p-1.5 shadow-2xl"
        style={{ top: flyoutTop, left: collapsed ? 76 : 268 }}>
        <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Cài đặt</p>
        {settingsItems.map((item) => <Link prefetch={false} key={item.href} href={item.href} role="menuitem" onClick={() => setSettingsOpen(false)} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors", item.href === activeHref ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white")}><item.icon className="size-4 shrink-0" />{item.label}</Link>)}
      </div>}
      {onToggleCollapsed ? <button type="button" onClick={onToggleCollapsed} aria-expanded={!collapsed} title={collapsed ? "Mở rộng menu" : "Thu gọn menu"} className={cn("mx-3 mb-1 flex items-center gap-3 rounded-lg py-2 text-sm font-medium text-slate-400 hover:bg-slate-900 hover:text-white", collapsed ? "mx-2 justify-center px-0" : "px-3")}>{collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}{collapsed ? <span className="sr-only">Mở rộng menu</span> : "Thu gọn menu"}</button> : null}
      {collapsed ? <div className="m-2 flex justify-center border-t border-slate-800 pt-3"><div className="flex size-9 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white" title={`${account.fullName ?? account.email}`}>{(account.fullName ?? account.email).slice(0, 2).toUpperCase()}</div></div> : <div className="m-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center gap-2"><div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{(account.fullName ?? account.email).slice(0, 2).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-xs font-semibold text-white">{account.fullName ?? "Đang thiết lập tài khoản"}</p><p className="truncate text-[11px] text-slate-400">{account.email}</p></div></div>
        {account.workspaceName && <p className="mt-2 truncate border-t border-slate-800 pt-2 text-[11px] text-slate-500">{account.workspaceName}</p>}
        <SignOutButton />
      </div>}
    </aside>
  );
}
