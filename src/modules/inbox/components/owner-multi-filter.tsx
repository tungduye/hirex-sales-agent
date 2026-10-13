"use client";

import { Check, Search, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { OmnichannelInboxProfile } from "../types/omnichannel-inbox";

export function OwnerMultiFilter(props: {
  profiles: OmnichannelInboxProfile[];
  accounts: import("../types/omnichannel-inbox").OmnichannelInboxAccount[];
  selectedOwnerIds: string[];
  channel: string | null;
  account: string | null;
  tagIds: string[];
  tagMatchMode: "all" | "any";
  clearHref: string;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("vi-VN");
  const visibleProfiles = useMemo(() => normalizedQuery
    ? props.profiles.filter((profile) => profile.fullName.toLocaleLowerCase("vi-VN").includes(normalizedQuery))
    : props.profiles, [normalizedQuery, props.profiles]);
  const selected = new Set(props.selectedOwnerIds);
  const selectedProfiles = props.profiles.filter((profile) => selected.has(profile.id));
  const selectedAccountIds = new Set(selectedProfiles.some((profile) => profile.allChannelAccounts)
    ? props.accounts.map((account) => account.id)
    : selectedProfiles.flatMap((profile) => profile.channelAccountIds));
  const selectedAccounts = props.accounts.filter((account) => selectedAccountIds.has(account.id));

  return <form action="/inbox/all" className="border-t border-slate-200 p-3">
    {props.channel ? <input type="hidden" name="channel" value={props.channel}/> : null}
    {props.account ? <input type="hidden" name="account" value={props.account}/> : null}
    {props.tagIds.map((id) => <input key={id} type="hidden" name="tag" value={id}/>)}
    {props.tagIds.length ? <input type="hidden" name="tagMode" value={props.tagMatchMode}/> : null}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><UsersRound className="size-4 text-blue-600"/>Lọc theo owner</div>
        <p className="mt-1 text-xs text-slate-500">Chọn một hoặc nhiều thành viên để xem hội thoại từ các tài khoản kênh họ được phân quyền.</p>
      </div>
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"/>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm owner..." className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400"/>
      </div>
    </div>
    <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
      {visibleProfiles.length ? <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{visibleProfiles.map((profile) => {
        const isSelected = selected.has(profile.id);
        const initials = profile.fullName.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("vi-VN");
        return <label key={profile.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${isSelected ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:border-blue-200 hover:bg-slate-50"}`}>
          <input type="checkbox" name="owner" value={profile.id} defaultChecked={isSelected} className="peer sr-only"/>
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-transparent peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white"><Check className="size-3.5"/></span>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{initials || "TV"}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{profile.fullName}</span><span className="block text-[11px] text-slate-500">{profile.allChannelAccounts ? "Tất cả tài khoản kênh" : `${profile.channelAccountIds.length} tài khoản kênh`}</span></span>
        </label>;
      })}</div> : <p className="px-3 py-8 text-center text-sm text-slate-500">Không tìm thấy owner phù hợp.</p>}
    </div>
    {props.selectedOwnerIds.length ? <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-600">Tài khoản kênh thuộc owner đã chọn</p><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{selectedAccounts.length} tài khoản</span></div>
      {selectedAccounts.length ? <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">{selectedAccounts.map((account) => <span key={account.id} className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${healthy(account.healthLabel) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}><strong>{channelLabel(account.channelType)}</strong> · {account.displayName} · {healthLabel(account.healthLabel)}</span>)}</div> : <p className="mt-2 text-sm text-slate-500">Owner đã chọn chưa được cấp tài khoản kênh nào.</p>}
    </div> : null}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-medium text-slate-500">{props.selectedOwnerIds.length ? `Đang lọc ${props.selectedOwnerIds.length} owner` : "Chưa chọn owner — hiển thị tất cả"}</span>
      <div className="flex gap-2">
        {props.selectedOwnerIds.length ? <a href={props.clearHref} className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-rose-600"><X className="size-4"/>Bỏ lọc</a> : null}
        <button className="h-10 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700">Áp dụng owner</button>
      </div>
    </div>
  </form>;
}

function healthy(value: string) { return value === "Healthy" || value === "Connected"; }
function channelLabel(channel: import("@/modules/channels/core/channel-contracts").ChannelType) { return channel === "EMAIL" ? "Email" : channel === "FACEBOOK" ? "Facebook Page" : channel === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : channel === "ZALO" ? "Zalo" : channel; }
function healthLabel(value: string) { return value === "Healthy" ? "Ổn định" : value === "Connected" ? "Đã kết nối" : value === "Reconnect required" ? "Cần kết nối lại" : value === "Disconnected" ? "Mất kết nối" : value === "Unknown" ? "Đang kiểm tra" : value; }
