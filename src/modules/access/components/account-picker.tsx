"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

import { type PickerAccount } from "../core/picker-accounts";
export { toPickerAccounts, type PickerAccount } from "../core/picker-accounts";

const CHANNELS: Array<[string, string]> = [["ZALO", "Zalo"], ["FACEBOOK", "Page"], ["FACEBOOK_PROFILE", "Cá nhân"], ["EMAIL", "Email"]];
const channelName = (value: string) => CHANNELS.find(([key]) => key === value)?.[1] ?? value;
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/**
 * Searchable account checklist for a form: search, channel chips, "Đã chọn" view, select/clear what is shown.
 * Submits the chosen ids as hidden inputs named `name`, so the server action reads formData.getAll(name).
 */
export function AccountPicker({ name, accounts, selected, ownerNote = false, disabled = false }: { name: string; accounts: PickerAccount[]; selected: string[]; ownerNote?: boolean; disabled?: boolean }) {
  const [chosen, setChosen] = useState(() => new Set(selected));
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("ALL");
  const [onlyChosen, setOnlyChosen] = useState(false);
  // Chosen at load first, then by name; the order stays put while ticking.
  const ordered = useMemo(() => { const first = new Set(selected); return [...accounts].sort((a, b) => Number(first.has(b.id)) - Number(first.has(a.id)) || a.name.localeCompare(b.name, "vi")); }, [accounts, selected]);
  const needle = fold(query.trim());
  const shown = ordered.filter((item) => (channel === "ALL" || item.channel === channel) && (!onlyChosen || chosen.has(item.id)) && (!needle || fold(`${item.name} ${item.owner ?? ""} ${item.detail ?? ""}`).includes(needle)));
  const counts = new Map<string, number>(); for (const item of accounts) counts.set(item.channel, (counts.get(item.channel) ?? 0) + 1);
  const toggle = (id: string) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const setShown = (on: boolean) => setChosen((current) => { const next = new Set(current); for (const item of shown) { if (on) next.add(item.id); else next.delete(item.id); } return next; });

  return <div className={cn("mt-3 rounded-xl border border-slate-200 bg-white", disabled && "pointer-events-none opacity-50")} aria-disabled={disabled}>
    {[...chosen].map((id) => <input key={id} type="hidden" name={name} value={id}/>)}
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-2.5">
      <label className="relative min-w-[180px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tài khoản hoặc người dùng…" aria-label="Tìm tài khoản" className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-7 text-sm outline-none focus:border-blue-400 focus:bg-white"/>{query ? <button type="button" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm" className="absolute right-1 top-1 rounded p-1 text-slate-400 hover:text-slate-700"><X className="size-3.5"/></button> : null}</label>
      <div className="flex flex-wrap gap-1">{[["ALL", "Tất cả", accounts.length] as const, ...CHANNELS.filter(([key]) => counts.get(key)).map(([key, label]) => [key, label, counts.get(key) ?? 0] as const)].map(([key, label, count]) => <button key={key} type="button" onClick={() => setChannel(key)} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", channel === key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>{label} <span className="tabular-nums text-slate-400">{count}</span></button>)}</div>
      <button type="button" onClick={() => setOnlyChosen((value) => !value)} className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", onlyChosen ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>Đã chọn <span className="tabular-nums">{chosen.size}</span></button>
    </div>
    <div className="flex items-center justify-between gap-2 px-3 pt-2 text-xs text-slate-500"><span>Đang hiện {shown.length}/{accounts.length}</span><span className="flex gap-3"><button type="button" onClick={() => setShown(true)} disabled={!shown.length} className="font-semibold text-blue-700 hover:underline disabled:opacity-40">Chọn hết {shown.length} đang hiện</button><button type="button" onClick={() => setShown(false)} disabled={!shown.length} className="font-semibold text-slate-600 hover:underline disabled:opacity-40">Bỏ chọn đang hiện</button></span></div>
    <ul className="grid max-h-72 gap-1 overflow-y-auto p-2 sm:grid-cols-2 xl:grid-cols-3">
      {shown.map((item) => { const on = chosen.has(item.id); return <li key={item.id}><label className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-sm", on ? "border-blue-300 bg-blue-50/60" : "border-transparent hover:bg-slate-50")}>
        <input type="checkbox" checked={on} onChange={() => toggle(item.id)} className="size-4 shrink-0 accent-blue-600"/>
        <span className="min-w-0 flex-1"><span className="block truncate text-slate-800">{item.name}</span><span className="block truncate text-[11px] text-slate-400" title={item.detail ?? undefined}>{channelName(item.channel)}{item.detail ? <span className="text-slate-500"> · {item.detail}</span> : null}{item.needsReconnect ? <span className="text-rose-500"> · cần kết nối lại</span> : null}{ownerNote ? item.owner ? <span className={on ? "font-semibold text-amber-700" : "text-amber-700"}> · {on ? `chuyển từ ${item.owner}` : `của ${item.owner}`}</span> : item.free ? <span> · chưa có người dùng chính</span> : null : null}</span></span>
      </label></li>; })}
      {!shown.length ? <li className="col-span-full py-6 text-center text-sm text-slate-400">Không có tài khoản phù hợp</li> : null}
    </ul>
  </div>;
}
