"use client";

import { CheckCheck, FolderInput, FolderOutput, LoaderCircle, Plus, Search, Tag, TagsIcon, Undo2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OmnichannelInboxProfile, OmnichannelInboxTag } from "../types/omnichannel-inbox";

export type BulkAction = "TAG_ADD" | "TAG_REMOVE" | "MARK_READ" | "MOVE_OTHER" | "MOVE_PRIMARY" | "ASSIGN";
export interface BulkDone { operationId: string; text: string; at: number }
/** What the bar applies to: the picked rows, or every conversation the filters select. */
export type BulkTarget = { kind: "rows"; conversationIds: string[]; rowCount: number } | { kind: "filter"; filterQuery: string; count: number; more: boolean };

const UNDO_KEY = "hirex.inbox.lastBulk";
const UNDO_MS = 10 * 60 * 1000;

export function readLastBulk(): BulkDone | null {
  try { const value = JSON.parse(window.localStorage.getItem(UNDO_KEY) ?? "null") as BulkDone | null; return value && Date.now() - value.at < UNDO_MS ? value : null; } catch { return null; }
}
function saveLastBulk(value: BulkDone | null) { try { if (value) window.localStorage.setItem(UNDO_KEY, JSON.stringify(value)); else window.localStorage.removeItem(UNDO_KEY); } catch { /* storage unavailable */ } }

/**
 * Bar shown while conversations are picked: tag / untag, mark read, move to Khác or back, assign. Picked rows,
 * or (after "Chọn tất cả theo bộ lọc") every conversation the filters select, up to 5,000, after a confirmation.
 */
export function InboxBulkBar(props: {
  target: BulkTarget; visibleCount: number; allVisiblePicked: boolean; tags: OmnichannelInboxTag[]; profiles: OmnichannelInboxProfile[];
  onPickVisible: () => void; onPickFilter: () => void; onClear: () => void; pickingFilter: boolean;
  onTagCreated: (tag: OmnichannelInboxTag) => void;
  onDone: (action: BulkAction, input: { tagIds: string[]; assigneeId: string | null }, done: BulkDone) => void;
}) {
  const [menu, setMenu] = useState<null | "TAG_ADD" | "TAG_REMOVE" | "ASSIGN">(null);
  const [confirm, setConfirm] = useState<null | { action: BulkAction; tagIds: string[]; assigneeId: string | null; text: string }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const count = props.target.kind === "rows" ? props.target.rowCount : props.target.count;
  const countText = props.target.kind === "filter" ? `${props.target.count.toLocaleString("vi-VN")}${props.target.more ? "+" : ""} hội thoại theo bộ lọc` : `${count} hội thoại`;

  useEffect(() => {
    if (!menu) return;
    const onClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setMenu(null); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", onClick); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [menu]);

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

  const button = "inline-flex h-7 min-w-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-50";
  return <div ref={rootRef} className="relative rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5" role="toolbar" aria-label="Thao tác hàng loạt">
    <div className="flex items-center gap-1.5 text-xs">
      <button type="button" onClick={props.onClear} aria-label="Bỏ chọn" title="Bỏ chọn (Esc)" className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-white hover:text-slate-800"><X className="size-4"/></button>
      <span className="min-w-0 truncate font-bold text-blue-900">Đã chọn {countText}</span>
      {busy ? <LoaderCircle className="ml-auto size-4 shrink-0 animate-spin text-blue-600" aria-label="Đang làm"/> : null}
    </div>
    {props.target.kind === "rows" ? <div className="mt-0.5 flex flex-wrap gap-x-3 pl-6 text-[11px]">
      {!props.allVisiblePicked && props.visibleCount > count ? <button type="button" onClick={props.onPickVisible} className="font-semibold text-blue-700 hover:underline">Chọn cả {props.visibleCount} đang hiện</button> : null}
      <button type="button" onClick={props.onPickFilter} disabled={props.pickingFilter} className="font-semibold text-blue-700 hover:underline disabled:opacity-50" title="Mọi hội thoại khớp bộ lọc, tab và tìm kiếm (tối đa 5.000)">{props.pickingFilter ? "Đang đếm…" : "Chọn tất cả theo bộ lọc"}</button>
    </div> : null}
    <div className="mt-1 grid grid-cols-3 gap-0.5">
      <button type="button" disabled={busy} onClick={() => setMenu(menu === "TAG_ADD" ? null : "TAG_ADD")} className={button}><Tag className="size-3.5 shrink-0"/>Gắn nhãn</button>
      <button type="button" disabled={busy} onClick={() => setMenu(menu === "TAG_REMOVE" ? null : "TAG_REMOVE")} className={button}><TagsIcon className="size-3.5 shrink-0"/>Bỏ nhãn</button>
      <button type="button" disabled={busy} onClick={() => void run("MARK_READ", [], null)} className={button}><CheckCheck className="size-3.5 shrink-0"/>Đã đọc</button>
      <button type="button" disabled={busy} onClick={() => void run("MOVE_OTHER", [], null)} className={button} title="Chuyển vào Khác"><FolderInput className="size-3.5 shrink-0"/>Vào Khác</button>
      <button type="button" disabled={busy} onClick={() => void run("MOVE_PRIMARY", [], null)} className={button} title="Chuyển về Chính"><FolderOutput className="size-3.5 shrink-0"/>Về Chính</button>
      <button type="button" disabled={busy} onClick={() => setMenu(menu === "ASSIGN" ? null : "ASSIGN")} className={button}><UserRound className="size-3.5 shrink-0"/>Giao cho</button>
    </div>
    {confirm ? <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" role="alertdialog" aria-label="Xác nhận">
      <p><b>{confirm.text}</b> cho {countText}?</p>
      <div className="mt-1.5 flex gap-1.5"><button type="button" onClick={() => void run(confirm.action, confirm.tagIds, confirm.assigneeId, true)} className="rounded-md bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700">Xác nhận</button><button type="button" onClick={() => setConfirm(null)} className="rounded-md px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100">Huỷ</button></div>
    </div> : null}
    {error ? <p role="alert" className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
    {menu === "TAG_ADD" || menu === "TAG_REMOVE" ? <TagPicker mode={menu} tags={props.tags} onCreated={props.onTagCreated} onApply={(tagIds) => void run(menu, tagIds, null)}/> : null}
    {menu === "ASSIGN" ? <PersonPicker profiles={props.profiles} onPick={(id) => void run("ASSIGN", [], id)}/> : null}
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
