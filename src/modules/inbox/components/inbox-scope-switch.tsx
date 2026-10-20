"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { INBOX_REFRESH_EVENT } from "./inbox-refresh-event";

type Scope = "MINE" | "TEAM" | "ALL";

function rememberScope(value: Scope) {
  document.cookie = `hirex_inbox_scope=${value}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Phạm vi: Của tôi (accounts I am the main user of) | Team (mine + the people I manage) | Tất cả
 * (everything I may access). Remembered in a cookie per browser; access itself is unchanged.
 */
export function InboxScopeSwitch({ scope, counts }: { scope: Scope; counts: { mine: number; team: number; all: number; hasTeam: boolean } }) {
  const [pending, setPending] = useState<Scope | null>(null);
  const options: Array<{ value: Scope; label: string; count: number; title: string }> = [
    { value: "MINE", label: "Của tôi", count: counts.mine, title: "Tài khoản bạn là người dùng chính" },
    ...(counts.hasTeam ? [{ value: "TEAM" as const, label: "Team", count: counts.team, title: "Tài khoản của bạn và những người bạn quản lý" }] : []),
    { value: "ALL", label: "Tất cả", count: counts.all, title: "Mọi tài khoản bạn được cấp quyền" },
  ];
  function choose(value: Scope) {
    if (value === scope) return;
    setPending(value);
    rememberScope(value);
    window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
    setTimeout(() => setPending(null), 4000);
  }
  return <div role="radiogroup" aria-label="Phạm vi tài khoản" className="flex rounded-lg bg-slate-100 p-0.5">
    {options.map((option) => {
      const active = (pending ?? scope) === option.value;
      return <button key={option.value} type="button" role="radio" aria-checked={active} title={option.title} onClick={() => choose(option.value)}
        className={cn("flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors", active ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
        {option.label}<span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-blue-50 text-blue-700" : "bg-white/70 text-slate-500")}>{option.count}</span>
      </button>;
    })}
  </div>;
}
