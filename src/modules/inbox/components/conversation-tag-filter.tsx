"use client";

import { useActionState } from "react";
import { Tag, X } from "lucide-react";
import { createConversationTag } from "@/modules/channels/server/channel-actions";
import type { OmnichannelInboxTag } from "../types/omnichannel-inbox";

const initial = { status: "idle" as const, message: null };

export function ConversationTagFilter(props: {
  tags: OmnichannelInboxTag[];
  selectedTagIds: string[];
  tagMatchMode: "all" | "any";
  channel: string | null;
  account: string | null;
  firstMessageFrom: string | null;
  firstMessageTo: string | null;
  ownerIds?: string[];
}) {
  const [state, createAction, pending] = useActionState(createConversationTag, initial);
  const selected = new Set(props.selectedTagIds);
  return <details className="relative">
    <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700">
      <Tag className="size-4"/>Nhãn{selected.size > 0 ? <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">{selected.size}</span> : null}
    </summary>
    <div className="absolute right-0 z-30 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
      <form className="space-y-3">
        {props.channel ? <input type="hidden" name="channel" value={props.channel}/> : null}
        {props.account ? <input type="hidden" name="account" value={props.account}/> : null}
        {props.firstMessageFrom ? <input type="hidden" name="firstFrom" value={props.firstMessageFrom}/> : null}
        {props.firstMessageTo ? <input type="hidden" name="firstTo" value={props.firstMessageTo}/> : null}
        {(props.ownerIds ?? []).map((id) => <input key={id} type="hidden" name="owner" value={id}/>)}
        <div className="flex items-center justify-between"><p className="font-bold text-slate-900">Lọc theo nhãn</p>{selected.size > 0 ? <a href={clearHref(props.channel, props.account, props.firstMessageFrom, props.firstMessageTo, props.ownerIds ?? [])} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-rose-600"><X className="size-3"/>Bỏ lọc</a> : null}</div>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2 text-xs">
          <label className="flex items-center gap-2"><input type="radio" name="tagMode" value="all" defaultChecked={props.tagMatchMode === "all"}/>Có tất cả nhãn</label>
          <label className="flex items-center gap-2"><input type="radio" name="tagMode" value="any" defaultChecked={props.tagMatchMode === "any"}/>Có một nhãn</label>
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {props.tags.length === 0 ? <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Chưa có nhãn. Tạo nhãn đầu tiên bên dưới.</p> : props.tags.map((tag) => <label key={tag.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50"><input type="checkbox" name="tag" value={tag.id} defaultChecked={selected.has(tag.id)}/><span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color ?? "#64748b" }}/><span className="min-w-0 flex-1 truncate">{tag.name}</span></label>)}
        </div>
        <button className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">Áp dụng bộ lọc</button>
      </form>
      <div className="my-4 h-px bg-slate-100"/>
      <form action={createAction} className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Tạo nhãn mới</p>
        <div className="flex gap-2"><input name="name" required maxLength={80} placeholder="Ví dụ: Khách hàng" className="h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm outline-none focus:border-blue-400"/><input name="color" type="color" defaultValue="#2563eb" aria-label="Màu nhãn" className="h-9 w-11 cursor-pointer rounded-lg border bg-white p-1"/><button disabled={pending} className="rounded-lg bg-blue-600 px-3 text-xs font-bold text-white disabled:opacity-50">{pending ? "Đang tạo" : "Tạo"}</button></div>
        {state.message ? <p aria-live="polite" className={`text-xs ${state.status === "error" ? "text-rose-600" : "text-emerald-600"}`}>{state.status === "success" ? "Đã tạo nhãn." : state.message}</p> : null}
      </form>
    </div>
  </details>;
}

function clearHref(channel: string | null, account: string | null, firstMessageFrom: string | null, firstMessageTo: string | null, ownerIds: string[]) {
  const query = new URLSearchParams();
  if (channel) query.set("channel", channel);
  if (account) query.set("account", account);
  if (firstMessageFrom) query.set("firstFrom", firstMessageFrom);
  if (firstMessageTo) query.set("firstTo", firstMessageTo);
  for (const owner of ownerIds) query.append("owner", owner);
  return `/inbox/all${query.size ? `?${query}` : ""}`;
}
