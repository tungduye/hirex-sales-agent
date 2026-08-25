"use client";

import { useState, type ReactNode } from "react";
import { Bell, Menu, Search, X } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-[264px_1fr]">
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-slate-950/40" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[280px] shadow-2xl">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <Button variant="ghost" size="icon" className="absolute right-3 top-3 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X className="size-5" />
            </Button>
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-white/95 px-4 backdrop-blur md:px-6 lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="h-10 w-full rounded-lg border bg-slate-50 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none" placeholder="Search companies and contacts..." aria-label="Global search" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 sm:block">Manual mode</div>
            <Button variant="ghost" size="icon" aria-label="Notifications"><Bell className="size-5" /></Button>
            <div className="flex size-9 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white" aria-label="Alex Morgan profile">AM</div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
