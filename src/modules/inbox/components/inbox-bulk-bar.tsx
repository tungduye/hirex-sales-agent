"use client";

import { Bell, BellOff, Bot, BotOff, Check, CheckCheck, ChevronDown, LoaderCircle, Pin, Plus, Search, Star, Tag, TagsIcon, Trash2, Undo2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OmnichannelInboxConversation, OmnichannelInboxProfile, OmnichannelInboxTag } from "../types/omnichannel-inbox";

export type BulkAction = "TAG_ADD" | "TAG_REMOVE" | "MARK_READ" | "MOVE_OTHER" | "MOVE_PRIMARY" | "ASSIGN";
export interface BulkDone { operationId: string; text: string; at: number }
/** What the bar applies to: the picked rows, or every conversation the filters select. */
export type BulkTarget = { kind: "rows"; conversationIds: string[]; rowCount: number } | { kind: "filter"; filterQuery: string; count: number; more: boolean };
/** A change made to picked rows by the second line of the bar (pin, important, notifications, AI, delete). */
export type RowChange = { patch: Partial<OmnichannelInboxConversation> } | { deleted: true };

const UNDO_KEY = "hirex.inbox.lastBulk";
const UNDO_MS = 10 * 60 * 1000;
/** Pin, important, notifications, AI and delete go conversation by conversation: only for rows picked by hand. */
export const ROW_ACTION_LIMIT = 50;

export function readLastBulk(): BulkDone | null {
  try { const value = JSON.parse(window.localStorage.getItem(UNDO_KEY) ?? "null") as BulkDone | null; return value && Date.now() - value.at < UNDO_MS ? value : null; } catch { return null; }
}
function saveLastBulk(value: BulkDone | null) { try { if (value) window.localStorage.setItem(UNDO_KEY, JSON.stringify(value)); else window.localStorage.removeItem(UNDO_KEY); } catch { /* storage unavailable */ } }

type AiBots = { bots: Array<{ id: string; name: string; botType: string }>; bindings: Record<string, string> };
let aiBotsRequest: Promise<AiBots | null> | null = null;
function loadAiBots() {
  aiBotsRequest ??= fetch("/api/inbox/ai-bots", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<AiBots> : null).catch(() => null)
    .then((value) => { if (!value) aiBotsRequest = null; return value; });
  return aiBotsRequest;
}
const postJson = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.ok).catch(() => false);
/** Runs the calls a few at a time; true when at least one went through. */
async function each<T>(items: T[], call: (item: T) => Promise<boolean>) {
  let ok = 0;
  for (let start = 0; start < items.length; start += 8) ok += (await Promise.all(items.slice(start, start + 8).map(call))).filter(Boolean).length;
  return ok;
}

/**
 * The one place to act on conversations (picked by clicking their avatars): tag / untag, mark read, assign, and for
 * rows picked by hand also pin, important, notifications, AI version and delete (admin). Picked rows, or (after
 * "Chọn tất cả theo bộ lọc") every conversation the filters select, up to 5,000, after a confirmation.
 */
export function InboxBulkBar(props: {
  target: BulkTarget; rows: OmnichannelInboxConversation[]; visibleCount: number; allVisiblePicked: boolean; tags: OmnichannelInboxTag[]; profiles: OmnichannelInboxProfile[];
  canDelete: boolean;
  onPickVisible: () => void; onPickFilter: () => void; onClear: () => void; pickingFilter: boolean;
  onTagCreated: (tag: OmnichannelInboxTag) => void;
  onDone: (action: BulkAction, input: { tagIds: string[]; assigneeId: string | null }, done: BulkDone) => void;
  onRowsChanged: (rowIds: string[], change: RowChange) => void;
}) {
  const [menu, setMenu] = useState<null | "TAG_ADD" | "TAG_REMOVE" | "ASSIGN" | "PIN" | "AI" | "DELETE">(null);
  const [confirm, setConfirm] = useState<null | { action: BulkAction; tagIds: string[]; assigneeId: string | null; text: string }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiBots | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = props.target.kind === "rows" ? props.target.rowCount : props.target.count;
  const countText = props.target.kind === "filter" ? `${props.target.count.toLocaleString("vi-VN")}${props.target.more ? "+" : ""} hội thoại theo bộ lọc` : `${count} hội thoại`;
  const targetKind = props.target.kind;
  const rows = useMemo(() => targetKind === "rows" ? props.rows : [], [targetKind, props.rows]);
  const rowActions = rows.length > 0 && rows.length <= ROW_ACTION_LIMIT;
  const rowHint = props.target.kind === "filter" ? "Chỉ dùng khi tự chọn từng hội thoại" : rows.length > ROW_ACTION_LIMIT ? `Chọn tối đa ${ROW_ACTION_LIMIT} hội thoại cho thao tác này` : undefined;
  const all = (test: (row: OmnichannelInboxConversation) => boolean) => rows.length > 0 && rows.every(test);
  const allPinned = all((row) => row.isPinned), allMyPin = all((row) => row.isMyPin), allImportant = all((row) => row.isImportant), allMuted = all((row) => row.isMuted);
  // Only people who may see every picked nick can be given the conversations.
  const people = useMemo(() => rows.length === 0 ? props.profiles
    : props.profiles.filter((profile) => profile.allChannelAccounts || rows.every((row) => (row.copyAccountIds.length ? row.copyAccountIds : [row.channelAccountId]).some((id) => profile.channelAccountIds.includes(id)))), [props.profiles, rows]);

  useEffect(() => {
    if (!menu) return;
    const onClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenu(null); };
    // Esc closes the open menu only; the picked rows stay picked (a second Esc clears them).
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopImmediatePropagation(); setMenu(null); } };
    document.addEventListener("mousedown", onClick); document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey, true); };
  }, [menu]);
  useEffect(() => { if (menu === "AI" && !ai) void loadAiBots().then((value) => { if (value) setAi(value); else setError("Chưa tải được danh sách phiên bản AI."); }); }, [menu, ai]);

  const describe = (action: BulkAction, tagIds: string[], assigneeId: string | null) => {
    const names = props.tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => `“${tag.name}”`).join(", ");
    const person = props.profiles.find((profile) => profile.id === assigneeId)?.fullName;
    return action === "TAG_ADD" ? `Gắn nhãn ${names}` : action === "TAG_REMOVE" ? `Bỏ nhãn ${names}` : action === "MARK_READ" ? "Đánh dấu đã đọc"
      : action === "MOVE_OTHER" ? "Chuyển vào Khác" : action === "MOVE_PRIMARY" ? "Chuyển về Chính" : assigneeId ? `Giao cho ${person ?? "người đã chọn"}` : "Bỏ người được giao";
  };

  const run = async (action: BulkAction, tagIds: string[], assigneeId: string | null, confirmed = false) => {
    setMenu(null); setError(null);
    const text = describe(action, tagIds, assigneeId);
    // Everything the filters select is confirmed first; picked rows can be undone right after.
    if (props.target.kind === "filter" && !confirmed) { setConfirm({ action, tagIds, assigneeId, text }); return; }
    if (props.target.kind === "filter" && props.target.more) { setError("Bộ lọc chọn hơn 5.000 hội thoại. Hãy lọc hẹp hơn."); return; }
    setConfirm(null); setBusy(true);
    try {
      const body = { action, tagIds, assigneeId, ...(props.target.kind === "rows" ? { conversationIds: props.target.conversationIds } : { filterQuery: props.target.filterQuery }) };
      const response = await fetch("/api/inbox/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null) as { operationId?: string; affected?: number; skipped?: number; error?: string } | null;
      if (!response.ok || !payload?.operationId) { setError(payload?.error ?? "Chưa làm được, vui lòng thử lại."); return; }
      const skipped = payload.skipped ? ` · bỏ qua ${payload.skipped} (không có quyền với nick)` : "";
      const done = { operationId: payload.operationId, text: `${text}: ${payload.affected ?? 0} hội thoại thay đổi${skipped}`, at: Date.now() };
      saveLastBulk(done);
      props.onDone(action, { tagIds, assigneeId }, done);
    } catch { setError("Mất kết nối, vui lòng thử lại."); } finally { setBusy(false); }
  };

  /** Sets a flag on every picked row (each copy of a merged Zalo group), touching only the rows not already set. */
  const setFlag = async (field: "isPinned" | "isMyPin" | "isImportant" | "isMuted", action: string, want: boolean) => {
    setMenu(null); setError(null); setBusy(true);
    const changing = rows.filter((row) => row[field] !== want);
    const ok = await each(changing.flatMap((row) => row.copyIds.length ? row.copyIds : [row.id]), (id) => postJson(`/api/inbox/conversations/${id}/preferences`, { action }));
    setBusy(false);
    if (changing.length && !ok) { setError("Chưa làm được, vui lòng thử lại."); return; }
    props.onRowsChanged(changing.map((row) => row.id), { patch: { [field]: want } });
  };
  const setAiMode = async (enabled: boolean, botId: string | null) => {
    setMenu(null); setError(null); setBusy(true);
    const ok = await each(rows.flatMap((row) => row.copyIds.length ? row.copyIds : [row.id]), (id) => postJson(`/api/inbox/conversations/${id}/ai`, { enabled, botId }));
    setBusy(false);
    if (!ok) { setError("Chưa đổi được phiên bản AI."); return; }
    props.onRowsChanged(rows.map((row) => row.id), { patch: enabled ? { takeoverMode: "BOT_ALLOWED", aiBotId: botId } : { takeoverMode: "HUMAN_TAKEOVER" } });
  };
  const remove = async () => {
    setMenu(null); setError(null); setBusy(true);
    const ok = await each(rows.flatMap((row) => row.copyIds.length ? row.copyIds : [row.id]), (id) => postJson(`/api/inbox/conversations/${id}/preferences`, { action: "SOFT_DELETE" }));
    setBusy(false);
    if (!ok) { setError("Chưa xóa được, vui lòng thử lại."); return; }
    props.onRowsChanged(rows.map((row) => row.id), { deleted: true });
  };

  const button = "inline-flex h-6 min-w-0 items-center gap-1 whitespace-nowrap rounded-md px-1 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-40 disabled:hover:bg-transparent";
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50";
  const aiOnAll = all((row) => row.takeoverMode === "BOT_ALLOWED"), aiOffAll = all((row) => row.takeoverMode !== "BOT_ALLOWED");
  const nickBot = ai && rows.length === 1 ? ai.bots.find((bot) => bot.id === ai.bindings[rows[0].channelAccountId]) ?? null : null;
  return <div ref={rootRef} className="relative rounded-lg border border-blue-200 bg-blue-50 px-2 py-1" role="toolbar" aria-label="Thao tác với hội thoại đã chọn">
    <div className="flex items-center gap-1.5 text-xs">
      <button type="button" onClick={props.onClear} aria-label="Bỏ chọn" title="Bỏ chọn (Esc)" className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white hover:text-slate-800"><X className="size-4"/></button>
      <span className="shrink-0 font-bold text-blue-900">{props.target.kind === "rows" ? `Đã chọn ${count}` : `Đã chọn ${countText}`}</span>
      {props.target.kind === "rows" ? <span className="flex min-w-0 items-center gap-2 truncate text-[11px]">
        {!props.allVisiblePicked && props.visibleCount > count ? <button type="button" onClick={props.onPickVisible} className="shrink-0 font-semibold text-blue-700 hover:underline">Chọn cả {props.visibleCount}</button> : null}
        <button type="button" onClick={props.onPickFilter} disabled={props.pickingFilter} className="truncate font-semibold text-blue-700 hover:underline disabled:opacity-50" title="Mọi hội thoại khớp bộ lọc, tab và tìm kiếm (tối đa 5.000)">{props.pickingFilter ? "Đang đếm…" : "Tất cả theo bộ lọc"}</button>
      </span> : null}
      {busy ? <LoaderCircle className="ml-auto size-4 shrink-0 animate-spin text-blue-600" aria-label="Đang làm"/> : null}
      {props.canDelete ? <button type="button" disabled={busy || !rowActions} title={rowHint ?? "Xóa hội thoại khỏi Suối Nguồn"} aria-label="Xóa hội thoại" onClick={() => setMenu(menu === "DELETE" ? null : "DELETE")} className={`${busy ? "" : "ml-auto"} shrink-0 rounded p-1 text-rose-600 hover:bg-white disabled:opacity-40`}><Trash2 className="size-4"/></button> : null}
    </div>
    <div className="mt-0.5 grid grid-cols-4 gap-0.5">
      <button type="button" disabled={busy} onClick={() => setMenu(menu === "TAG_ADD" ? null : "TAG_ADD")} className={button}><Tag className="size-3.5 shrink-0"/>Gắn nhãn</button>
      <button type="button" disabled={busy} onClick={() => setMenu(menu === "TAG_REMOVE" ? null : "TAG_REMOVE")} className={button}><TagsIcon className="size-3.5 shrink-0"/>Bỏ nhãn</button>
      <button type="button" disabled={busy} onClick={() => void run("MARK_READ", [], null)} className={button}><CheckCheck className="size-3.5 shrink-0"/>Đã đọc</button>
      <button type="button" disabled={busy} onClick={() => setMenu(menu === "ASSIGN" ? null : "ASSIGN")} className={button}><UserRound className="size-3.5 shrink-0"/>Giao cho</button>
      <button type="button" disabled={busy || !rowActions} title={rowHint} onClick={() => setMenu(menu === "PIN" ? null : "PIN")} className={button}><Pin className="size-3.5 shrink-0"/>Ghim<ChevronDown className="size-3 shrink-0"/></button>
      <button type="button" disabled={busy || !rowActions} title={rowHint ?? (allImportant ? "Bỏ khỏi Quan trọng" : "Chuyển vào Quan trọng")} onClick={() => void setFlag("isImportant", "TOGGLE_IMPORTANT", !allImportant)} className={button}><Star className={`size-3.5 shrink-0 ${allImportant ? "fill-amber-400 text-amber-500" : ""}`}/>{allImportant ? "Bỏ q.trọng" : "Quan trọng"}</button>
      <button type="button" disabled={busy || !rowActions} title={rowHint ?? (allMuted ? "Bật thông báo" : "Tắt thông báo")} onClick={() => void setFlag("isMuted", "TOGGLE_MUTE", !allMuted)} className={button}>{allMuted ? <Bell className="size-3.5 shrink-0"/> : <BellOff className="size-3.5 shrink-0"/>}{allMuted ? "Bật TB" : "Tắt TB"}</button>
      <button type="button" disabled={busy || !rowActions} title={rowHint ?? "Phiên bản AI"} onClick={() => setMenu(menu === "AI" ? null : "AI")} className={button}><Bot className="size-3.5 shrink-0"/>AI<span className={`rounded-full px-1 text-[10px] ${aiOnAll ? "bg-emerald-100 text-emerald-700" : aiOffAll ? "bg-slate-200 text-slate-500" : "bg-amber-100 text-amber-700"}`}>{aiOnAll ? "Bật" : aiOffAll ? "Tắt" : "Lẫn"}</span></button>
    </div>
    {confirm ? <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" role="alertdialog" aria-label="Xác nhận">
      <p><b>{confirm.text}</b> cho {countText}?</p>
      <div className="mt-1.5 flex gap-1.5"><button type="button" onClick={() => void run(confirm.action, confirm.tagIds, confirm.assigneeId, true)} className="rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700">Xác nhận</button><button type="button" onClick={() => setConfirm(null)} className="rounded-md px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100">Huỷ</button></div>
    </div> : null}
    {error ? <p role="alert" className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
    {menu === "TAG_ADD" || menu === "TAG_REMOVE" ? <TagPicker mode={menu} tags={props.tags} onCreated={props.onTagCreated} onApply={(tagIds) => void run(menu, tagIds, null)}/> : null}
    {menu === "ASSIGN" ? <PersonPicker profiles={people} onPick={(id) => void run("ASSIGN", [], id)}/> : null}
    {menu === "PIN" ? <div className="absolute inset-x-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl" role="menu" aria-label="Ghim">
      <button type="button" role="menuitem" className={item} onClick={() => void setFlag("isPinned", "TOGGLE_PIN", !allPinned)}><Pin className="size-4 text-blue-600"/>{allPinned ? "Bỏ ghim trong tất cả" : "Ghim trong tất cả"}</button>
      <button type="button" role="menuitem" className={item} onClick={() => void setFlag("isMyPin", "TOGGLE_MY_PIN", !allMyPin)}><Pin className="size-4 text-violet-600"/>{allMyPin ? "Bỏ ghim trong cá nhân" : "Ghim trong cá nhân"}</button>
    </div> : null}
    {menu === "AI" ? <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl" role="menu" aria-label="Phiên bản AI">
      <button type="button" role="menuitem" className={item} onClick={() => void setAiMode(false, null)}><BotOff className="size-4"/><span className="flex-1">Tắt AI</span>{aiOffAll ? <Check className="size-3.5 text-blue-600"/> : null}</button>
      <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Bật AI · chọn phiên bản</p>
      {!ai ? <p className="px-2 py-1.5 text-xs text-slate-500">Đang tải…</p> : <>
        <button type="button" role="menuitem" className={item} onClick={() => void setAiMode(true, null)}><Bot className="size-4"/><span className="min-w-0 flex-1 truncate">Theo nick{rows.length === 1 ? (nickBot ? ` (${nickBot.name})` : " (nick chưa gắn AI)") : " (AI gắn với từng nick)"}</span>{aiOnAll && rows.every((row) => !row.aiBotId) ? <Check className="size-3.5 text-blue-600"/> : null}</button>
        {ai.bots.map((bot) => <button key={bot.id} type="button" role="menuitem" className={item} onClick={() => void setAiMode(true, bot.id)}><Bot className="size-4"/><span className="min-w-0 flex-1 truncate">{bot.name}</span>{aiOnAll && rows.every((row) => row.aiBotId === bot.id) ? <Check className="size-3.5 text-blue-600"/> : null}</button>)}
        {ai.bots.length === 0 ? <p className="px-2 py-1.5 text-xs text-slate-500">Chưa có phiên bản AI nào đang bật.</p> : null}
      </>}
    </div> : null}
    {menu === "DELETE" ? <div className="absolute inset-x-0 top-full z-40 mt-1 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900 shadow-xl" role="alertdialog" aria-label="Xác nhận xóa">
      <p>Xóa <b>{rows.length} hội thoại</b> khỏi Suối Nguồn?</p>
      <div className="mt-2 flex justify-end gap-1.5"><button type="button" onClick={() => setMenu(null)} className="rounded-md px-2.5 py-1 font-semibold hover:bg-rose-100">Hủy</button><button type="button" onClick={() => void remove()} className="rounded-md bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-700">Xóa</button></div>
    </div> : null}
  </div>;
}

function TagPicker(props: { mode: "TAG_ADD" | "TAG_REMOVE"; tags: OmnichannelInboxTag[]; onCreated: (tag: OmnichannelInboxTag) => void; onApply: (tagIds: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [color, setColor] = useState("#2563eb");
  const [error, setError] = useState<string | null>(null);
  const needle = fold(query);
  const shown = useMemo(() => props.tags.filter((tag) => !needle || fold(tag.name).includes(needle)), [needle, props.tags]);
  const exact = props.tags.some((tag) => fold(tag.name) === needle);
  const create = async () => {
    const name = query.trim();
    if (!name) return;
    setCreating(true); setError(null);
    try {
      const response = await fetch("/api/inbox/tags", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, color }) });
      const payload = await response.json().catch(() => null) as (OmnichannelInboxTag & { error?: string }) | null;
      if (!response.ok || !payload?.id) { setError(payload?.error ?? "Chưa tạo được nhãn."); return; }
      props.onCreated({ id: payload.id, name: payload.name, color: payload.color });
      setPicked((current) => new Set(current).add(payload.id)); setQuery("");
    } catch { setError("Mất kết nối, vui lòng thử lại."); } finally { setCreating(false); }
  };
  return <div className="absolute inset-x-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
    <label className="relative block"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-slate-400"/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && props.mode === "TAG_ADD" && query.trim() && !exact) { event.preventDefault(); void create(); } }} placeholder={props.mode === "TAG_ADD" ? "Tìm hoặc tạo nhãn…" : "Tìm nhãn…"} className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-xs outline-none focus:border-blue-400 focus:bg-white"/></label>
    <div className="mt-1.5 max-h-52 overflow-y-auto">
      {shown.map((tag) => <label key={tag.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-slate-50"><input type="checkbox" checked={picked.has(tag.id)} onChange={() => setPicked((current) => { const next = new Set(current); if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id); return next; })}/><span className="size-2.5 rounded-full" style={{ background: tag.color ?? "#94a3b8" }}/><span className="truncate">{tag.name}</span></label>)}
      {shown.length === 0 && !query ? <p className="px-1.5 py-2 text-xs text-slate-500">Chưa có nhãn nào.</p> : null}
    </div>
    {props.mode === "TAG_ADD" && query.trim() && !exact ? <div className="mt-1 flex items-center gap-1.5 border-t border-slate-100 pt-1.5"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Màu nhãn" className="h-7 w-8 cursor-pointer rounded border border-slate-200 p-0.5"/><button type="button" disabled={creating} onClick={() => void create()} className="inline-flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><Plus className="size-3.5 shrink-0"/><span className="truncate">{creating ? "Đang tạo…" : `Tạo nhãn “${query.trim()}”`}</span></button></div> : null}
    {error ? <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p> : null}
    <div className="mt-1.5 flex justify-end border-t border-slate-100 pt-1.5"><button type="button" disabled={picked.size === 0} onClick={() => props.onApply([...picked])} className="h-7 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40">{props.mode === "TAG_ADD" ? "Gắn" : "Bỏ"} {picked.size || ""} nhãn</button></div>
  </div>;
}

function PersonPicker(props: { profiles: OmnichannelInboxProfile[]; onPick: (id: string | null) => void }) {
  const [query, setQuery] = useState("");
  const needle = fold(query);
  const shown = props.profiles.filter((profile) => !needle || fold(profile.fullName).includes(needle));
  return <div className="absolute inset-x-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
    {props.profiles.length > 6 ? <label className="relative mb-1 block"><Search className="pointer-events-none absolute left-2 top-2 size-3.5 text-slate-400"/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm người…" className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-2 text-xs outline-none focus:border-blue-400 focus:bg-white"/></label> : null}
    <div className="max-h-52 overflow-y-auto">
      {shown.map((profile) => <button key={profile.id} type="button" onClick={() => props.onPick(profile.id)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50">{profile.fullName}</button>)}
      <button type="button" onClick={() => props.onPick(null)} className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50">Bỏ người được giao</button>
    </div>
  </div>;
}

/** "Đã gắn nhãn … · Hoàn tác" for the last bulk action (its author, within 10 minutes). */
export function BulkUndoNotice(props: { done: BulkDone; onUndone: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/inbox/bulk/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: props.done.operationId }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) { setError(payload?.error ?? "Chưa hoàn tác được."); return; }
      saveLastBulk(null); props.onUndone();
    } catch { setError("Mất kết nối, vui lòng thử lại."); } finally { setBusy(false); }
  };
  return <div className="flex items-start gap-2 rounded-lg bg-slate-900 px-2.5 py-2 text-xs text-white" role="status">
    <span className="min-w-0 flex-1">{props.done.text}{error ? <span className="block text-rose-300">{error}</span> : null}</span>
    <button type="button" disabled={busy} onClick={() => void undo()} className="inline-flex shrink-0 items-center gap-1 font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-50"><Undo2 className="size-3.5"/>{busy ? "…" : "Hoàn tác"}</button>
    <button type="button" onClick={() => { saveLastBulk(null); props.onClose(); }} aria-label="Đóng" className="shrink-0 text-slate-400 hover:text-white"><X className="size-3.5"/></button>
  </div>;
}

function fold(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").replace(/Đ/gu, "D").toLowerCase().trim(); }
