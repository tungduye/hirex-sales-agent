"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import type { OmnichannelInboxAccount } from "../types/omnichannel-inbox";

type Group = { key: string; label: string; accounts: OmnichannelInboxAccount[] };

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim();

/** Accounts grouped by main user (mine first), with unread counts; several may be picked. Submits one `account=id1,id2`. */
export function InboxAccountFilter({ accounts, selected, currentUserId }: { accounts: OmnichannelInboxAccount[]; selected: string[]; currentUserId: string | null }) {
  const [chosen, setChosen] = useState(() => new Set(selected));
  const [query, setQuery] = useState("");
  const needle = fold(query);
  const shown = accounts.filter((account) => !needle || fold(`${account.displayName} ${account.primaryName ?? ""}`).includes(needle));
  const groups = new Map<string, Group>();
  for (const account of shown) {
    const owner = account.primaryProfileId ?? "";
    const key = owner === currentUserId ? "me" : owner || "none";
    const label = key === "me" ? "Của tôi" : key === "none" ? "Chưa có người dùng chính" : account.primaryName ?? "Người khác";
    const group = groups.get(key) ?? { key, label, accounts: [] };
    group.accounts.push(account);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.key === "me" ? -1 : b.key === "me" ? 1 : a.key === "none" ? 1 : b.key === "none" ? -1 : a.label.localeCompare(b.label, "vi")));
  const toggle = (ids: string[], on: boolean) => setChosen((current) => { const next = new Set(current); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });

  return <section>
    {chosen.size ? <input type="hidden" name="account" value={[...chosen].join(",")}/> : null}
    <div className="mb-1 flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tài khoản {chosen.size ? <span className="text-blue-700">· đã chọn {chosen.size}</span> : null}</p>{chosen.size ? <button type="button" onClick={() => setChosen(new Set())} className="text-[11px] font-semibold text-slate-500 hover:text-rose-600">Bỏ chọn</button> : null}</div>
    {accounts.length > 6 ? <label className="relative mb-1.5 block"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tài khoản hoặc người dùng…" aria-label="Tìm tài khoản" className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-7 text-xs outline-none focus:border-blue-400 focus:bg-white"/>{query ? <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm" className="absolute right-1 top-1 rounded p-1 text-slate-400 hover:text-slate-700"><X className="size-3.5"/></button> : null}</label> : null}
    <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
      {ordered.map((group) => {
        const ids = group.accounts.map((account) => account.id);
        const picked = ids.filter((id) => chosen.has(id)).length;
        const unread = group.accounts.reduce((sum, account) => sum + (account.unreadCount ?? 0), 0);
        return <div key={group.key}>
          <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-2 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
            <input type="checkbox" checked={picked === ids.length} ref={(element) => { if (element) element.indeterminate = picked > 0 && picked < ids.length; }} onChange={(event) => toggle(ids, event.target.checked)} className="size-3.5 accent-blue-600"/>
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{group.label} <span className="font-normal text-slate-400">· {ids.length}</span></span>
            {unread ? <span className="rounded-full bg-rose-50 px-1.5 text-[10px] font-bold text-rose-600" title={`${unread} hội thoại của người chưa đọc (không tính thư tự động)`}>{unread > 999 ? "999+" : unread}</span> : null}
          </label>
          {group.accounts.map((account) => <label key={account.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-50 py-1.5 pl-6 pr-2 last:border-b-0 hover:bg-slate-50">
            <input type="checkbox" checked={chosen.has(account.id)} onChange={(event) => toggle([account.id], event.target.checked)} className="size-3.5 shrink-0 accent-blue-600"/>
            <ChannelLogo channel={account.channelType} size={14}/>
            <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{account.displayName}</span>
            {account.unreadCount ? <span className="shrink-0 rounded-full bg-blue-600 px-1.5 text-[10px] font-bold leading-4 text-white" title={`${account.unreadCount} hội thoại của người chưa đọc${account.unreadAutomated ? ` · ${account.unreadAutomated} thư tự động không tính` : ""}`}>{account.unreadCount > 99 ? "99+" : account.unreadCount}</span> : null}
          </label>)}
        </div>;
      })}
      {!ordered.length ? <p className="px-3 py-4 text-center text-xs text-slate-500">Không tìm thấy tài khoản phù hợp.</p> : null}
    </div>
  </section>;
}
