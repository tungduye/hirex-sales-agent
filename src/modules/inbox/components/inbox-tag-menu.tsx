"use client";

import Image from "next/image";
import { ChevronLeft, GripVertical, LoaderCircle, Plus, Search, Tag, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChannelLogo } from "@/modules/channels/components/channel-logo";
import type { OmnichannelInboxConversation, OmnichannelInboxTag } from "../types/omnichannel-inbox";
import { INBOX_REFRESH_EVENT } from "./inbox-refresh-event";

// "Phân loại" next to the search box, like Zalo: filter by Tất cả / Chưa đọc and by tags (a tick filters at once),
// and "Quản lý thẻ phân loại": drag to reorder, add, rename, recolour, see and change which conversations carry a
// tag, delete (admin). Tags are shared by the whole company and stay in HireX (not synced to the Zalo app).

/** Zalo-like palette. */
export const TAG_COLORS = ["#E53935", "#F4511E", "#FB8C00", "#F6BF26", "#33B679", "#0B8043", "#039BE5", "#2563EB", "#3F51B5", "#8E24AA", "#D81B60", "#616161"];
const DEFAULT_COLOR = "#E53935";

function TagIcon({ color, className = "size-4" }: { color: string | null; className?: string }) {
  return <Tag className={`${className} shrink-0`} style={{ color: color ?? "#94a3b8", fill: color ?? "#94a3b8" }} strokeWidth={1.5} aria-hidden="true"/>;
}

export function InboxTagMenu(props: { tags: OmnichannelInboxTag[]; selectedTagIds: string[]; unreadOnly: boolean; canManage: boolean; canDelete: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = new Set(props.selectedTagIds);
  const active = props.selectedTagIds.length + (props.unreadOnly ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey); document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  // A tick filters at once (no "Áp dụng"); several tags = conversations with at least one of them, like Zalo.
  const apply = (tagIds: string[], unread: boolean) => {
    const query = new URLSearchParams(searchParams.toString());
    query.delete("tag"); query.delete("tagMode"); query.delete("cursor"); query.delete("page");
    for (const id of tagIds) query.append("tag", id);
    if (tagIds.length) query.set("tagMode", "any");
    if (unread) query.set("unread", "1"); else query.delete("unread");
    const next = query.toString();
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  };
  const toggleTag = (id: string) => apply(selected.has(id) ? props.selectedTagIds.filter((item) => item !== id) : [...props.selectedTagIds, id], props.unreadOnly);

  return <div ref={rootRef} className="shrink-0">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label="Phân loại: Chưa đọc, thẻ phân loại" title="Phân loại"
      className={`relative flex size-9 items-center justify-center rounded-lg border ${active || open ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
      <Tag className="size-4"/>{active ? <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{active}</span> : null}
    </button>
    {open ? <div role="dialog" aria-label="Phân loại" className="absolute inset-x-2 top-[52px] z-40 flex max-h-[calc(100dvh-14rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl">
      <p className="px-3 pb-1 pt-1 text-[12px] font-semibold text-slate-500">Theo trạng thái</p>
      {([[false, "Tất cả"], [true, "Chưa đọc"]] as const).map(([unread, label]) => <label key={label} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] text-slate-800 hover:bg-slate-50">
        <input type="radio" name="inbox-read-state" checked={props.unreadOnly === unread} onChange={() => apply(props.selectedTagIds, unread)} className="size-4 accent-blue-600"/>{label}
      </label>)}
      <p className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 text-[12px] font-semibold text-slate-500">Theo thẻ phân loại</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.tags.length === 0 ? <p className="px-3 py-2 text-xs text-slate-500">Chưa có thẻ phân loại nào.</p>
          : props.tags.map((tag) => <label key={tag.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] text-slate-800 hover:bg-slate-50">
            <input type="checkbox" checked={selected.has(tag.id)} onChange={() => toggleTag(tag.id)} className="size-4 shrink-0 accent-blue-600"/>
            <TagIcon color={tag.color}/><span className="min-w-0 flex-1 truncate">{tag.name}</span>
          </label>)}
      </div>
      {active ? <button type="button" onClick={() => apply([], false)} className="mx-3 mt-1 self-start text-xs font-semibold text-slate-500 hover:text-rose-600">Bỏ lọc phân loại</button> : null}
      {props.canManage ? <button type="button" onClick={() => { setManaging(true); setOpen(false); }} className="mt-1.5 border-t border-slate-100 px-3 pt-2 text-center text-[13px] font-semibold text-slate-700 hover:text-blue-700">Quản lý thẻ phân loại</button> : null}
    </div> : null}
    {managing ? <TagManager tags={props.tags} canDelete={props.canDelete} onClose={() => setManaging(false)}/> : null}
  </div>;
}

type Linked = { id: string; name: string; avatarUrl: string | null; channelType: string; accountName: string };
type Detail = { id: string | null; name: string; color: string };

function post(url: string, body: unknown, method = "POST") {
  return fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => null) as Record<string, unknown> | null })).catch(() => ({ ok: false, data: null }));
}
const refreshInbox = () => window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));

/** "Quản lý thẻ phân loại" and "Chi tiết thẻ phân loại". */
function TagManager(props: { tags: OmnichannelInboxTag[]; canDelete: boolean; onClose: () => void }) {
  const [tags, setTags] = useState(props.tags);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orderBefore = useRef<string>("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props]);

  const saveOrder = async (list: OmnichannelInboxTag[]) => {
    const order = list.map((tag) => tag.id).join(",");
    if (order === orderBefore.current) return;
    const result = await post("/api/inbox/tags/order", { tagIds: list.map((tag) => tag.id) });
    if (!result.ok) { setError(String(result.data?.error ?? "Chưa lưu được thứ tự.")); setTags(props.tags); return; }
    setError(null); refreshInbox();
  };
  const moveOver = (overId: string) => {
    if (!dragging || dragging === overId) return;
    setTags((current) => {
      const from = current.findIndex((tag) => tag.id === dragging), to = current.findIndex((tag) => tag.id === overId);
      if (from < 0 || to < 0) return current;
      const next = current.slice(); const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
      return next;
    });
  };

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={detail ? "Chi tiết thẻ phân loại" : "Quản lý thẻ phân loại"} className="flex max-h-[85dvh] w-full max-w-[480px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      {detail ? <TagDetail detail={detail} canDelete={props.canDelete} onBack={() => setDetail(null)} onClose={props.onClose}
        onSaved={(tag, created) => { setTags((current) => created ? [...current, tag] : current.map((item) => item.id === tag.id ? tag : item)); setDetail(null); refreshInbox(); }}
        onDeleted={(id) => { setTags((current) => current.filter((item) => item.id !== id)); setDetail(null); refreshInbox(); }}/> : <>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3"><h2 className="text-[15px] font-bold text-slate-900">Quản lý thẻ phân loại</h2><button type="button" onClick={props.onClose} aria-label="Đóng" className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><X className="size-5"/></button></div>
        <p className="shrink-0 px-4 pb-1 pt-3 text-[13px] text-slate-600">Danh sách thẻ phân loại</p>
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 pb-2" aria-label="Kéo để sắp xếp">
          {tags.length === 0 ? <li className="py-6 text-center text-sm text-slate-500">Chưa có thẻ phân loại nào.</li> : tags.map((tag) => <li key={tag.id}
            draggable onDragStart={(event) => { setDragging(tag.id); orderBefore.current = tags.map((item) => item.id).join(","); event.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(event) => { event.preventDefault(); moveOver(tag.id); }} onDragEnd={() => { setDragging(null); void saveOrder(tags); }}
            className={`flex items-center gap-2 ${dragging === tag.id ? "opacity-50" : ""}`}>
            <span className="cursor-grab p-1 text-slate-400 active:cursor-grabbing" title="Kéo để đổi thứ tự"><GripVertical className="size-4"/></span>
            <button type="button" onClick={() => setDetail({ id: tag.id, name: tag.name, color: tag.color ?? DEFAULT_COLOR })} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg bg-slate-100 px-3 py-2.5 text-left text-[13px] text-slate-800 hover:bg-slate-200">
              <TagIcon color={tag.color} className="size-[18px]"/><span className="truncate">{tag.name}</span>
            </button>
          </li>)}
        </ul>
        {error ? <p role="alert" className="px-4 pb-1 text-xs text-rose-600">{error}</p> : null}
        <button type="button" onClick={() => setDetail({ id: null, name: "", color: DEFAULT_COLOR })} className="flex shrink-0 items-center gap-1.5 border-t border-slate-100 px-6 py-3 text-[13px] font-semibold text-blue-700 hover:bg-blue-50"><Plus className="size-4"/>Thêm phân loại</button>
      </>}
    </div>
  </div>;
}

function TagDetail(props: { detail: Detail; canDelete: boolean; onBack: () => void; onClose: () => void; onSaved: (tag: OmnichannelInboxTag, created: boolean) => void; onDeleted: (id: string) => void }) {
  const [name, setName] = useState(props.detail.name);
  const [color, setColor] = useState(props.detail.color);
  const [palette, setPalette] = useState(false);
  const [linked, setLinked] = useState<Linked[] | null>(props.detail.id ? null : []);
  const [total, setTotal] = useState(0);
  const [added, setAdded] = useState<Map<string, Linked & { ids: string[] }>>(() => new Map());
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.detail.id) return;
    let alive = true;
    void fetch(`/api/inbox/tags/${props.detail.id}/conversations`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).catch(() => null)
      .then((value: { conversations?: Linked[]; total?: number } | null) => { if (!alive) return; if (value?.conversations) { setLinked(value.conversations); setTotal(value.total ?? value.conversations.length); } else { setLinked([]); setError("Chưa tải được hội thoại của thẻ."); } });
    return () => { alive = false; };
  }, [props.detail.id]);

  const trimmed = name.replace(/\s+/gu, " ").trim();
  const changed = trimmed !== props.detail.name || color !== props.detail.color || added.size > 0 || removed.size > 0;
  const shown = [...[...added.values()], ...(linked ?? []).filter((item) => !removed.has(item.id))];
  const knownIds = new Set([...(linked ?? []).map((item) => item.id), ...[...added.values()].flatMap((item) => item.ids)]);

  const save = async () => {
    if (!trimmed) { setError("Nhập tên thẻ phân loại."); return; }
    setBusy(true); setError(null);
    try {
      let id = props.detail.id;
      if (!id) {
        const result = await post("/api/inbox/tags", { name: trimmed, color });
        if (!result.ok || typeof result.data?.id !== "string") { setError(String(result.data?.error ?? "Chưa tạo được thẻ.")); return; }
        id = result.data.id;
      } else if (trimmed !== props.detail.name || color !== props.detail.color) {
        const result = await post(`/api/inbox/tags/${id}`, { name: trimmed, color }, "PATCH");
        if (!result.ok) { setError(String(result.data?.error ?? "Chưa lưu được thẻ.")); return; }
      }
      const addIds = [...added.values()].flatMap((item) => item.ids);
      if (addIds.length) { const result = await post("/api/inbox/bulk", { action: "TAG_ADD", tagIds: [id], conversationIds: addIds }); if (!result.ok) { setError(String(result.data?.error ?? "Chưa gán được thẻ cho hội thoại.")); return; } }
      if (removed.size) { const result = await post("/api/inbox/bulk", { action: "TAG_REMOVE", tagIds: [id], conversationIds: [...removed] }); if (!result.ok) { setError(String(result.data?.error ?? "Chưa gỡ được thẻ khỏi hội thoại.")); return; } }
      props.onSaved({ id, name: trimmed, color }, !props.detail.id);
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!props.detail.id) return;
    setBusy(true); setError(null);
    const result = await post(`/api/inbox/tags/${props.detail.id}`, {}, "DELETE");
    setBusy(false);
    if (!result.ok) { setError(String(result.data?.error ?? "Chưa xóa được thẻ.")); setConfirmDelete(false); return; }
    props.onDeleted(props.detail.id);
  };

  return <>
    <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-3">
      <button type="button" onClick={props.onBack} aria-label="Quay lại" className="rounded-md p-1 text-slate-600 hover:bg-slate-100"><ChevronLeft className="size-5"/></button>
      <h2 className="flex-1 text-[15px] font-bold text-slate-900">{props.detail.id ? "Chi tiết thẻ phân loại" : "Thêm thẻ phân loại"}</h2>
      <button type="button" onClick={props.onClose} aria-label="Đóng" className="rounded-md p-1 text-slate-500 hover:bg-slate-100"><X className="size-5"/></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <label htmlFor="tag-name" className="text-[13px] text-slate-700">Tên thẻ phân loại</label>
      <div className="relative mt-1.5">
        <input id="tag-name" autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && changed && !busy) void save(); }} placeholder="Ví dụ: Khách hàng" className="h-10 w-full rounded-lg border border-slate-300 pl-3 pr-12 text-sm outline-none focus:border-blue-500"/>
        <button type="button" onClick={() => setPalette((value) => !value)} aria-label="Chọn màu thẻ" aria-expanded={palette} className="absolute right-1 top-1 flex h-8 w-9 items-center justify-center rounded-md bg-slate-100 hover:bg-slate-200"><TagIcon color={color} className="size-[18px]"/></button>
        {palette ? <div className="absolute right-0 top-11 z-10 grid grid-cols-6 gap-1.5 rounded-lg border border-slate-200 bg-white p-2 shadow-lg" role="listbox" aria-label="Màu thẻ">
          {TAG_COLORS.map((value) => <button key={value} type="button" role="option" aria-selected={value.toLowerCase() === color.toLowerCase()} aria-label={value} onClick={() => { setColor(value); setPalette(false); }}
            className={`flex size-7 items-center justify-center rounded-md hover:bg-slate-100 ${value.toLowerCase() === color.toLowerCase() ? "ring-2 ring-blue-500" : ""}`}><TagIcon color={value} className="size-[18px]"/></button>)}
        </div> : null}
      </div>
      <p className="mt-4 text-[13px] text-slate-700">Hội thoại được gán thẻ{linked ? <span className="text-slate-400"> · {total - removed.size + [...added.values()].length}</span> : null}</p>
      <button type="button" onClick={() => setAdding((value) => !value)} className="mt-1 flex items-center gap-1.5 py-1.5 text-[13px] font-semibold text-blue-700 hover:underline"><Plus className="size-4"/>Thêm hội thoại</button>
      {adding ? <ConversationPicker knownIds={knownIds} onPick={(item) => setAdded((current) => new Map(current).set(item.id, item))}/> : null}
      {linked === null ? <p className="flex items-center gap-2 py-3 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin"/>Đang tải…</p>
        : shown.length === 0 ? <p className="py-2 text-xs text-slate-500">Chưa có hội thoại nào được gán thẻ này.</p>
        : <ul className="mt-1 space-y-0.5">{shown.map((item) => <li key={item.id} className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-slate-50">
          <Avatar name={item.name} url={item.avatarUrl}/>
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-slate-800">{item.name}{added.has(item.id) ? <span className="ml-1.5 rounded bg-blue-50 px-1 text-[10px] font-semibold text-blue-700">mới</span> : null}</span>
            <span className="flex items-center gap-1 truncate text-[11px] text-slate-500"><ChannelLogo channel={channelOf(item.channelType)} size={12}/>{item.accountName}</span></span>
          <button type="button" aria-label={`Gỡ thẻ khỏi ${item.name}`} title="Gỡ thẻ khỏi hội thoại" onClick={() => { if (added.has(item.id)) setAdded((current) => { const next = new Map(current); next.delete(item.id); return next; }); else setRemoved((current) => new Set(current).add(item.id)); }}
            className="rounded-md p-1 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"><X className="size-4"/></button>
        </li>)}{total > (linked?.length ?? 0) ? <li className="px-1.5 py-1 text-[11px] text-slate-400">Hiện {linked?.length} hội thoại gần nhất trên {total}.</li> : null}</ul>}
      {error ? <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
    {confirmDelete ? <div className="shrink-0 border-t border-rose-100 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-900" role="alertdialog" aria-label="Xác nhận xóa thẻ">
      Xóa thẻ <b>{props.detail.name}</b>? Thẻ sẽ được gỡ khỏi {total} hội thoại và không khôi phục được.
      <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setConfirmDelete(false)} className="h-8 rounded-md px-3 font-semibold text-rose-900 hover:bg-rose-100">Hủy</button><button type="button" disabled={busy} onClick={() => void remove()} className="h-8 rounded-md bg-rose-600 px-3 font-semibold text-white hover:bg-rose-700 disabled:opacity-50">Xóa thẻ</button></div>
    </div> : null}
    <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 px-4 py-3">
      {props.detail.id && props.canDelete && !confirmDelete ? <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-rose-600 hover:bg-rose-50"><Trash2 className="size-4"/>Xóa thẻ</button> : null}
      <span className="flex-1"/>
      <button type="button" onClick={props.onBack} className="h-9 rounded-lg bg-slate-200 px-4 text-[13px] font-semibold text-slate-800 hover:bg-slate-300">Hủy</button>
      <button type="button" disabled={!changed || busy || !trimmed} onClick={() => void save()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300">{busy ? <LoaderCircle className="size-4 animate-spin"/> : null}{props.detail.id ? "Cập nhật" : "Tạo thẻ"}</button>
    </div>
  </>;
}

/** "Thêm hội thoại": search people and groups (the nicks this member may see) and tick them. */
function ConversationPicker(props: { knownIds: Set<string>; onPick: (item: Linked & { ids: string[] }) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OmnichannelInboxConversation[] | null>(null);
  const [loading, setLoading] = useState(false);
  const value = query.replace(/\s+/gu, " ").trim();
  useEffect(() => {
    if (value.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      const load = (view: string) => fetch(`/api/inbox/conversations?view=${view}&q=${encodeURIComponent(value)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ conversations: OmnichannelInboxConversation[] }> : { conversations: [] }).catch(() => ({ conversations: [] as OmnichannelInboxConversation[] }));
      void Promise.all([load("all"), load("groups")]).then(([people, groups]) => { if (!controller.signal.aborted) { setResults([...new Map([...people.conversations, ...groups.conversations].map((item) => [item.id, item])).values()].slice(0, 40)); setLoading(false); } });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value]);
  const list = useMemo(() => value.length < 2 ? [] : results ?? [], [results, value]);
  return <div className="mb-2 rounded-lg border border-slate-200 p-2">
    <label className="relative block"><Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-slate-400"/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên, SĐT, nhóm…" className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-7 pr-2 text-[13px] outline-none focus:border-blue-400 focus:bg-white"/></label>
    <div className="mt-1 max-h-48 overflow-y-auto">
      {value.length < 2 ? <p className="px-1.5 py-2 text-[11px] text-slate-500">Gõ ít nhất 2 ký tự.</p>
        : loading && !results ? <p className="flex items-center gap-2 px-1.5 py-2 text-[11px] text-slate-500"><LoaderCircle className="size-3.5 animate-spin"/>Đang tìm…</p>
        : list.length === 0 ? <p className="px-1.5 py-2 text-[11px] text-slate-500">Không tìm thấy hội thoại.</p>
        : list.map((item) => {
          const ids = item.copyIds.length ? item.copyIds : [item.id];
          const has = ids.every((id) => props.knownIds.has(id));
          const label = item.contactName ?? item.participantName ?? "Khách chưa rõ tên";
          return <button key={item.id} type="button" disabled={has} onClick={() => props.onPick({ id: item.id, ids, name: label, avatarUrl: item.avatarUrl, channelType: item.channelType, accountName: item.accountDisplayName })}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-slate-50 disabled:opacity-50">
            <Avatar name={label} url={item.avatarUrl} small/><span className="min-w-0 flex-1"><span className="block truncate text-[13px] text-slate-800">{label}</span><span className="block truncate text-[11px] text-slate-500">{item.accountDisplayName}</span></span>
            <span className="text-[11px] font-semibold text-blue-700">{has ? "Đã gán" : "Thêm"}</span>
          </button>;
        })}
    </div>
  </div>;
}

function Avatar({ name, url, small = false }: { name: string; url: string | null; small?: boolean }) {
  const size = small ? 28 : 32;
  if (url) return <Image unoptimized src={url} alt="" width={size} height={size} className="shrink-0 rounded-full bg-slate-100 object-cover" style={{ width: size, height: size }}/>;
  const letters = name.split(/\s+/u).filter((word) => /\p{L}|\d/u.test(word)).slice(-2).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?";
  return <span className="flex shrink-0 items-center justify-center rounded-full bg-slate-500 text-[11px] font-bold text-white" style={{ width: size, height: size }}>{letters}</span>;
}

const LOGO = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"] as const;
function channelOf(value: string) { return (LOGO as readonly string[]).includes(value) ? value as (typeof LOGO)[number] : "EMAIL"; }
