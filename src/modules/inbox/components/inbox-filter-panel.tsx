"use client";

import { Check, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InboxAccountFilter } from "./inbox-account-filter";
import type { OmnichannelInboxAccount, OmnichannelInboxTag } from "../types/omnichannel-inbox";


/**
 * One compact filter panel for the narrow conversation column: account and owners in a single
 * form with one "Áp dụng" button. Channel chips and quick tabs stay outside the panel.
 */
export function InboxFilterPanel(props: {
  accounts: OmnichannelInboxAccount[];
  /** Người phụ trách = người dùng chính of the nicks, with how many nicks each. */
  owners: Array<{ id: string; fullName: string; accountCount: number }>;
  tags: OmnichannelInboxTag[];
  view: string;
  search: string;
  channel: string | null;
  selectedAccountIds: string[];
  currentUserId: string | null;
  selectedTagIds: string[];
  tagMatchMode: "all" | "any";
  selectedOwnerIds: string[];
  firstMessageFrom: string | null;
  firstMessageTo: string | null;
  unreadOnly?: boolean;
  clearHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  // Tags and Chưa đọc are counted on the Phân loại button.
  const active = (props.selectedAccountIds.length ? 1 : 0) + props.selectedOwnerIds.length + (props.firstMessageFrom || props.firstMessageTo ? 1 : 0);

  // Close on Escape or a click outside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  const needle = fold(ownerQuery);
  const owners = useMemo(() => needle ? props.owners.filter((profile) => fold(profile.fullName).includes(needle)) : props.owners, [needle, props.owners]);
  const selectedOwners = new Set(props.selectedOwnerIds);
  // Owners already picked stay on top so they are easy to untick.
  const sortedOwners = [...owners].sort((a, b) => Number(selectedOwners.has(b.id)) - Number(selectedOwners.has(a.id)));

  return <div ref={rootRef} className="shrink-0">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="Bộ lọc: tài khoản, người phụ trách" title="Bộ lọc: tài khoản, người phụ trách" className={`relative flex size-9 items-center justify-center rounded-lg border ${active || open ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
      <SlidersHorizontal className="size-4"/>{active ? <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{active}</span> : null}
    </button>
    {open ? <div className="absolute inset-x-2 top-[52px] z-40 flex max-h-[calc(100dvh-14rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2.5"><p className="text-sm font-bold text-slate-900">Bộ lọc</p><button type="button" onClick={() => setOpen(false)} aria-label="Đóng bộ lọc" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4"/></button></div>
      <form action="/inbox/all" className="flex min-h-0 flex-1 flex-col">
        {props.channel ? <input type="hidden" name="channel" value={props.channel}/> : null}
        {props.firstMessageFrom ? <input type="hidden" name="firstFrom" value={props.firstMessageFrom}/> : null}
        {props.firstMessageTo ? <input type="hidden" name="firstTo" value={props.firstMessageTo}/> : null}
        {props.view && props.view !== "all" ? <input type="hidden" name="view" value={props.view}/> : null}
        {props.search ? <input type="hidden" name="q" value={props.search}/> : null}
        {/* Tags and Chưa đọc are set in Phân loại; applying this panel keeps them. */}
        {props.selectedTagIds.map((id) => <input key={id} type="hidden" name="tag" value={id}/>)}
        {props.selectedTagIds.length ? <input type="hidden" name="tagMode" value={props.tagMatchMode}/> : null}
        {props.unreadOnly ? <input type="hidden" name="unread" value="1"/> : null}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
          <InboxAccountFilter accounts={props.accounts} selected={props.selectedAccountIds} currentUserId={props.currentUserId}/>

          <section>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500" title="Người dùng chính của nick">Người phụ trách (chủ nick)</p>
            {props.owners.length > 6 ? <label className="relative mb-1.5 block"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-slate-400"/><input value={ownerQuery} onChange={(event) => setOwnerQuery(event.target.value)} placeholder="Tìm người…" className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-xs outline-none focus:border-blue-400 focus:bg-white"/></label> : null}
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-100">
              {sortedOwners.length ? sortedOwners.map((profile) => <label key={profile.id} className="flex cursor-pointer items-center gap-2.5 border-b border-slate-50 px-2 py-1.5 last:border-b-0 hover:bg-slate-50">
                <input type="checkbox" name="owner" value={profile.id} defaultChecked={selectedOwners.has(profile.id)} className="peer sr-only"/>
                <span className="flex size-4 shrink-0 items-center justify-center rounded border border-slate-300 bg-white text-transparent peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300"><Check className="size-3"/></span>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white">{initialsOf(profile.fullName)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{profile.fullName}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{profile.accountCount ? `${profile.accountCount} nick` : "chưa có nick"}</span>
              </label>) : <p className="px-3 py-4 text-center text-xs text-slate-500">Không tìm thấy người phù hợp.</p>}
            </div>
          </section>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
          {active ? <a href={props.clearHref} className="text-xs font-semibold text-slate-500 hover:text-rose-600">Xóa bộ lọc</a> : <span className="text-xs text-slate-400">Chưa lọc gì</span>}
          <button className="h-8 rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700">Áp dụng</button>
        </div>
      </form>
    </div> : null}
  </div>;
}

function fold(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim(); }
function initialsOf(name: string) { const words = name.split(/\s+/u).filter(Boolean); const pick = words.length > 1 ? [words[words.length - 2], words[words.length - 1]] : words; return pick.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?"; }
