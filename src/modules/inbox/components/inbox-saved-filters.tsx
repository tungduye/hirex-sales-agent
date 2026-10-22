"use client";

import { Bookmark, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { type SavedFilter, type SavedFilterScope, suggestFilterName } from "../core/saved-filters";
import { deleteSavedFilter, listSavedFilters, saveFilter } from "../server/saved-filter-actions";

const VIEW_KEY = "hirex.inbox.view";
const VIEW_NAMES: Record<string, string> = { all: "Tất cả", waiting: "Chưa trả lời", mine: "Giao cho tôi", groups: "Nhóm", other: "Khác" };
const SCOPE_NAMES: Record<string, string> = { MINE: "Cá nhân", TEAM: "Team", ALL: "Tất cả" };

function currentView() { try { return window.localStorage.getItem(VIEW_KEY); } catch { return null; } }

/** Open a saved filter: phạm vi (cookie), tab (this browser) and the list filters (URL). */
function openFilter(filter: SavedFilter) {
  if (filter.scope) document.cookie = `hirex_inbox_scope=${filter.scope}; path=/; max-age=31536000; samesite=lax`;
  try { if (filter.view) window.localStorage.setItem(VIEW_KEY, filter.view); } catch { /* storage unavailable */ }
  // A full load on purpose: the list reads the remembered tab and phạm vi only when it starts.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/inbox/all${filter.query ? `?${filter.query}` : ""}`);
}

/** "Bộ lọc đã lưu": one click re-applies a filter set; the current one can be saved under a name. */
export function InboxSavedFilters(props: { query: string; scope: SavedFilterScope | null; accountName: string | null; tagNames: string[]; ownerNames: string[] }) {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<SavedFilter[] | null>(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onClick = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true); setMessage(null);
    setName(suggestFilterName({ scope: props.scope, view: (currentView() as never) ?? null, query: props.query, accountName: props.accountName, tagNames: props.tagNames, ownerNames: props.ownerNames }));
    startTransition(async () => setFilters(await listSavedFilters()));
  }
  function save() {
    const view = currentView();
    startTransition(async () => {
      const result = await saveFilter({ name, query: props.query, scope: props.scope, view });
      if (result.ok) { setFilters(result.filters); setMessage("Đã lưu bộ lọc."); } else setMessage(result.message);
    });
  }
  function remove(id: string) { startTransition(async () => setFilters(await deleteSavedFilter(id))); }

  return <div ref={rootRef} className="shrink-0">
    <button type="button" onClick={toggle} aria-expanded={open} aria-label="Bộ lọc đã lưu" title="Bộ lọc đã lưu" className={`flex size-9 items-center justify-center rounded-lg border ${open ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}><Bookmark className="size-4"/></button>
    {open ? <div className="absolute inset-x-2 top-[52px] z-40 flex max-h-[calc(100dvh-14rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2.5"><p className="text-sm font-bold text-slate-900">Bộ lọc đã lưu</p><button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4"/></button></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filters === null ? <p className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500"><Loader2 className="size-3.5 animate-spin"/>Đang tải…</p>
          : filters.length === 0 ? <p className="px-2 py-5 text-center text-xs text-slate-500">Chưa có bộ lọc nào. Chọn phạm vi, tab, kênh, tài khoản… rồi lưu lại ở dưới để lần sau bấm một lần là xong.</p>
          : filters.map((filter) => <div key={filter.id} className="group flex items-center gap-1 rounded-lg hover:bg-slate-50">
            <button type="button" onClick={() => openFilter(filter)} className="min-w-0 flex-1 px-2 py-1.5 text-left"><span className="block truncate text-[13px] font-semibold text-slate-800">{filter.name}</span><span className="block truncate text-[11px] text-slate-500">{[filter.scope ? SCOPE_NAMES[filter.scope] : null, filter.view ? VIEW_NAMES[filter.view] : null].filter(Boolean).join(" · ") || "Bộ lọc"}</span></button>
            <button type="button" onClick={() => remove(filter.id)} disabled={pending} aria-label={`Xóa bộ lọc ${filter.name}`} title="Xóa bộ lọc" className="mr-1 rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600 group-hover:text-slate-400"><X className="size-3.5"/></button>
          </div>)}
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-slate-100 bg-slate-50 px-3 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Lưu bộ lọc đang xem</p>
        <p className="text-[11px] text-slate-500">Gồm phạm vi, tab đang mở, kênh, tài khoản, nhãn, người phụ trách và ngày.</p>
        <div className="flex gap-1.5"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} aria-label="Tên bộ lọc" placeholder="Tên bộ lọc" className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-400" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); save(); } }}/><button type="button" onClick={save} disabled={pending || !name.trim()} className="h-8 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Lưu</button></div>
        {message ? <p aria-live="polite" className="text-[11px] text-slate-600">{message}</p> : null}
      </div>
    </div> : null}
  </div>;
}
