"use client";

import { Search, UserSearch } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import { saveCandidateFactNicks, type CandidateFactNick } from "../server/candidate-fact-nicks";

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gu, "d").toLowerCase();

/** Settings → Kênh: which nicks are nick tuyển dụng (their one-to-one chats fill Thông tin ứng viên by themselves). */
export function CandidateFactNicks({ nicks }: { nicks: CandidateFactNick[] }) {
  const [enabled, setEnabled] = useState(() => new Set(nicks.filter((nick) => nick.enabled).map((nick) => nick.id)));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = useMemo(() => nicks.filter((nick) => !query || fold(`${nick.name} ${nick.owner ?? ""}`).includes(fold(query))), [nicks, query]);
  const changed = nicks.some((nick) => nick.enabled !== enabled.has(nick.id));
  const toggle = (ids: string[], on: boolean) => setEnabled((current) => { const next = new Set(current); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });
  const groups = ["ZALO", "FACEBOOK_PROFILE", "FACEBOOK"].map((channel) => ({ channel, items: shown.filter((nick) => nick.channelType === channel) })).filter((group) => group.items.length);
  const label: Record<string, string> = { ZALO: "Zalo", FACEBOOK_PROFILE: "Facebook cá nhân", FACEBOOK: "Facebook Page" };
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><UserSearch className="size-5 text-indigo-600"/>Nick tuyển dụng</h2>
        <p className="mt-1 text-sm text-slate-500">Chat 1-1 trên các nick được tích sẽ được AI tự đọc và ghi thông tin ứng viên vào Luồng Rec (kèm câu ứng viên đã nói). Bỏ qua nhóm. Tích thêm một nick thì 30 ngày chat gần nhất của nick đó cũng được đọc lại.</p></div>
      <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{enabled.size}/{nicks.length} nick</span>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm nick hoặc người dùng chính…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-sm outline-none focus:border-blue-400 focus:bg-white"/></label>
      <button type="button" disabled={!changed || pending} onClick={() => start(async () => { const result = await saveCandidateFactNicks([...enabled]); setMessage(result.message); })} className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang lưu…" : "Lưu"}</button>
    </div>
    {message ? <p role="status" className="mt-2 text-xs text-emerald-700">{message}</p> : null}
    <div className="mt-3 max-h-96 space-y-3 overflow-y-auto">
      {groups.map((group) => { const all = group.items.every((nick) => enabled.has(nick.id)); return <div key={group.channel}>
        <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><ChannelLogo channel={group.channel as ChannelType} size={14}/>{label[group.channel]} · {group.items.filter((nick) => enabled.has(nick.id)).length}/{group.items.length}
          <button type="button" onClick={() => toggle(group.items.map((nick) => nick.id), !all)} className="ml-auto font-semibold normal-case tracking-normal text-blue-700 hover:underline">{all ? "Bỏ chọn cả nhóm" : "Chọn cả nhóm"}</button></div>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{group.items.map((nick) => <label key={nick.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-sm hover:bg-slate-50">
          <input type="checkbox" checked={enabled.has(nick.id)} onChange={(event) => toggle([nick.id], event.target.checked)} className="size-4 accent-indigo-600"/>
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{nick.name}</span>
          <span className="shrink-0 truncate text-[11px] text-slate-500">{nick.owner ?? "chưa có người dùng chính"}{nick.ownerDepartment ? ` · ${nick.ownerDepartment}` : ""}</span>
        </label>)}</div>
      </div>; })}
      {groups.length === 0 ? <p className="text-sm text-slate-500">Không có nick Zalo/Facebook nào khớp.</p> : null}
    </div>
  </section>;
}
