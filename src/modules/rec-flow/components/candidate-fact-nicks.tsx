"use client";

import { Search, UserSearch } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import type { ChannelType } from "@/modules/channels/core/channel-contracts";
import { saveCandidateFactNicks, type CandidateFactNick } from "../server/candidate-fact-nicks";

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gu, "d").toLowerCase();
const MARKETS = [{ key: "IT", label: "IT" }, { key: "IT_JP", label: "IT JP" }, { key: "OTHER", label: "Khác" }] as const;
const FACT_CHANNELS = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE"];
const LABEL: Record<string, string> = { ZALO: "Zalo", FACEBOOK_PROFILE: "Facebook cá nhân", FACEBOOK: "Facebook Page", EMAIL: "Email" };

/**
 * Settings → Kênh, "Phân loại nick": the Thị trường of each nick (Suối Nguồn's people filter groups nicks
 * Bộ phận → Thị trường → Owner → nick) and which Zalo/Facebook nicks are nick tuyển dụng (their one-to-one chats
 * fill Thông tin ứng viên by themselves). The search narrows the list; the group buttons act on what is shown.
 */
export function CandidateFactNicks({ nicks }: { nicks: CandidateFactNick[] }) {
  const [enabled, setEnabled] = useState(() => new Set(nicks.filter((nick) => nick.enabled).map((nick) => nick.id)));
  const [markets, setMarkets] = useState<Record<string, string | null>>(() => Object.fromEntries(nicks.map((nick) => [nick.id, nick.market])));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = useMemo(() => nicks.filter((nick) => !query || fold(`${nick.name} ${nick.owner ?? ""} ${nick.ownerDepartment ?? ""}`).includes(fold(query))), [nicks, query]);
  const changed = nicks.some((nick) => nick.enabled !== enabled.has(nick.id) || (nick.market ?? null) !== (markets[nick.id] ?? null));
  const toggle = (ids: string[], on: boolean) => setEnabled((current) => { const next = new Set(current); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });
  const setMarket = (ids: string[], value: string | null) => setMarkets((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, value])) }));
  const groups = ["ZALO", "FACEBOOK_PROFILE", "FACEBOOK", "EMAIL"].map((channel) => ({ channel, items: shown.filter((nick) => nick.channelType === channel) })).filter((group) => group.items.length);
  const factNicks = nicks.filter((nick) => FACT_CHANNELS.includes(nick.channelType));
  const marketOf = (id: string) => markets[id] ?? "OTHER";
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1"><h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><UserSearch className="size-5 text-indigo-600"/>Phân loại nick</h2>
        <p className="mt-1 text-sm text-slate-500"><b>Thị trường</b> dùng cho bộ lọc người ở Suối Nguồn (Bộ phận → Thị trường → Owner → nick; bộ phận lấy theo người dùng chính). <b>Nick tuyển dụng</b>: chat 1-1 Zalo/Facebook được AI tự đọc và ghi thông tin ứng viên vào Luồng Rec; tích thêm nick nào thì 30 ngày chat gần nhất của nick đó cũng được đọc lại.</p></div>
      <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700" title="Nick tuyển dụng">{enabled.size}/{factNicks.length} nick tuyển dụng</span>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm nick, người dùng chính, bộ phận…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2 text-sm outline-none focus:border-blue-400 focus:bg-white"/></label>
      <button type="button" disabled={!changed || pending} onClick={() => start(async () => {
        const changedMarkets = Object.fromEntries(nicks.filter((nick) => (nick.market ?? null) !== (markets[nick.id] ?? null)).map((nick) => [nick.id, markets[nick.id] ?? null]));
        const result = await saveCandidateFactNicks([...enabled], changedMarkets); setMessage(result.message);
      })} className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Đang lưu…" : "Lưu"}</button>
    </div>
    {message ? <p role="status" className="mt-2 text-xs text-emerald-700">{message}</p> : null}
    <div className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto">
      {groups.map((group) => {
        const facts = FACT_CHANNELS.includes(group.channel);
        const all = group.items.every((nick) => enabled.has(nick.id));
        const ids = group.items.map((nick) => nick.id);
        return <div key={group.channel}>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><ChannelLogo channel={group.channel as ChannelType} size={14}/>{LABEL[group.channel]} · {group.items.length}
            <span className="ml-auto flex items-center gap-1 font-semibold normal-case tracking-normal">Thị trường {query ? "các nick đang hiện" : "cả nhóm"}:
              {MARKETS.map((market) => <button key={market.key} type="button" onClick={() => setMarket(ids, market.key === "OTHER" ? null : market.key)} className="rounded border border-slate-200 px-1.5 py-0.5 text-slate-600 hover:border-blue-300 hover:text-blue-700">{market.label}</button>)}</span>
            {facts ? <button type="button" onClick={() => toggle(ids, !all)} className="font-semibold normal-case tracking-normal text-blue-700 hover:underline">{all ? "Bỏ tuyển dụng" : "Tuyển dụng cả nhóm"}</button> : null}</div>
          <div className="grid gap-1 lg:grid-cols-2">{group.items.map((nick) => <div key={nick.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-1.5 text-sm hover:bg-slate-50">
            <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800">{nick.name}</span><span className="block truncate text-[11px] text-slate-500">{nick.owner ?? "chưa có người dùng chính"}{nick.ownerDepartment ? ` · ${nick.ownerDepartment}` : " · chưa xếp bộ phận"}</span></span>
            <span className="flex shrink-0 overflow-hidden rounded-md border border-slate-200" role="radiogroup" aria-label={`Thị trường của ${nick.name}`}>
              {MARKETS.map((market) => <button key={market.key} type="button" role="radio" aria-checked={marketOf(nick.id) === market.key} onClick={() => setMarket([nick.id], market.key === "OTHER" ? null : market.key)}
                className={`px-1.5 py-0.5 text-[11px] font-semibold ${marketOf(nick.id) === market.key ? "bg-blue-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}>{market.label}</button>)}
            </span>
            {facts ? <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] font-semibold text-slate-600" title="Nick tuyển dụng: tự ghi thông tin ứng viên"><input type="checkbox" checked={enabled.has(nick.id)} onChange={(event) => toggle([nick.id], event.target.checked)} className="size-4 accent-indigo-600"/>Tuyển dụng</label> : null}
          </div>)}</div>
        </div>;
      })}
      {groups.length === 0 ? <p className="text-sm text-slate-500">Không có nick nào khớp.</p> : null}
    </div>
  </section>;
}
