"use client";

import { useState, useTransition, type DragEvent, type ReactNode } from "react";
import { Check, ChevronRight, Eye, EyeOff, FileText, Folder, FolderOpen, GripVertical, LoaderCircle, Pencil, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NO_CATEGORY, pathKeys, type TreeFilter, type TreeNode } from "@/modules/content/core/content-tree";
import { addFolder, moveToFolder, renameFolder, reorderFolder, setFolderActive, type QuickResult } from "@/modules/content/server/content-quick-actions";

const FOLDER_COLORS = ["text-rose-500", "text-orange-400", "text-sky-500"];
/** dataTransfer type of a template / content dragged from the list onto a folder. */
export const ITEM_DRAG_TYPE = "application/x-hirex-content";
const FOLDER_DRAG_TYPE = "application/x-hirex-folder";

type Editing = { key: string; mode: "rename" | "add"; value: string } | null;

/**
 * Folder tree of Kho mẫu / Content đã tạo. People who manage the library edit it in place:
 * double-click or ✎ to rename, + to add a Phân loại (or a Bộ phận at the top), eye to hide,
 * drag a folder onto another to reorder, drag an item from the list onto a folder to move it.
 */
export function ContentFolderTree({ tree, total, unit, active, onChoose, canManage, itemKind, onChanged }: {
  tree: TreeNode[]; total: number; unit: string; active: TreeFilter; onChoose: (filter: TreeFilter) => void;
  canManage: boolean; itemKind: "template" | "content"; onChanged: (message: string) => void;
}) {
  const [opened, setOpened] = useState<Set<string>>(() => new Set(pathKeys(active)));
  const [editing, setEditing] = useState<Editing>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const run = (action: () => Promise<QuickResult>, after?: () => void) => start(async () => {
    setError(null);
    const result = await action().catch(() => ({ ok: false as const, message: "Không lưu được, thử lại sau." }));
    if (result.ok) { setEditing(null); after?.(); onChanged(result.message); } else setError(result.message);
  });
  const toggle = (key: string) => setOpened((value) => { const next = new Set(value); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const isActive = (node: TreeNode) => node.filter.department === active.department && node.filter.category === active.category && node.filter.format === active.format;
  const isCategory = (node: TreeNode) => node.depth === 1 && node.filter.category !== NO_CATEGORY;

  function rename(node: TreeNode, name: string) {
    if (!name.trim() || name.trim() === node.label) { setEditing(null); return; }
    run(() => node.depth === 0 ? renameFolder({ type: "option", kind: "DEPARTMENT", code: node.filter.department!, name })
      : node.depth === 2 ? renameFolder({ type: "option", kind: "FORMAT", code: node.filter.format!, name })
        : renameFolder({ type: "category", id: node.filter.category!, name }));
  }
  function hide(node: TreeNode) {
    const activeNext = Boolean(node.hidden);
    run(() => node.depth === 0 ? setFolderActive({ type: "option", kind: "DEPARTMENT", code: node.filter.department!, active: activeNext })
      : setFolderActive({ type: "category", id: node.filter.category!, active: activeNext }));
  }

  // Drag: a folder onto a sibling reorders; an item from the list onto a folder moves it there.
  function onDragStart(event: DragEvent, node: TreeNode) {
    event.dataTransfer.setData(FOLDER_DRAG_TYPE, JSON.stringify({ depth: node.depth, department: node.filter.department, category: node.filter.category }));
    event.dataTransfer.effectAllowed = "move";
  }
  function accepts(event: DragEvent) { return event.dataTransfer.types.includes(ITEM_DRAG_TYPE) || event.dataTransfer.types.includes(FOLDER_DRAG_TYPE); }
  function onDrop(event: DragEvent, node: TreeNode) {
    event.preventDefault(); setDropKey(null);
    const item = event.dataTransfer.getData(ITEM_DRAG_TYPE);
    if (item) {
      run(() => moveToFolder({ kind: itemKind, id: item, to: { department: node.filter.department, categoryId: node.filter.category && node.filter.category !== NO_CATEGORY ? node.filter.category : null, format: node.filter.format ?? null } }));
      return;
    }
    const raw = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
    if (!raw) return;
    const from = JSON.parse(raw) as { depth: number; department: string; category?: string };
    if (from.depth === 0 && node.depth === 0 && from.department !== node.filter.department) run(() => reorderFolder({ type: "option", kind: "DEPARTMENT", code: from.department, beforeCode: node.filter.department! }));
    else if (from.depth === 1 && isCategory(node) && from.department === node.filter.department && from.category && from.category !== node.filter.category) run(() => reorderFolder({ type: "category", id: from.category!, beforeId: node.filter.category! }));
  }

  function input(key: string, initial: string, onSave: (value: string) => void, placeholder: string) {
    return <form className="flex items-center gap-1 py-1 pr-1" onSubmit={(event) => { event.preventDefault(); onSave(editing?.value ?? initial); }}>
      <input autoFocus value={editing?.key === key ? editing.value : initial} onChange={(event) => setEditing((value) => value && { ...value, value: event.target.value })}
        onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }} maxLength={60} placeholder={placeholder} disabled={busy}
        className="h-7 min-w-0 flex-1 rounded border border-indigo-300 bg-white px-2 text-xs focus:outline-none" />
      <button type="submit" disabled={busy} aria-label="Lưu" className="rounded p-1 text-emerald-600 hover:bg-emerald-50">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}</button>
      <button type="button" onClick={() => setEditing(null)} aria-label="Huỷ" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="size-3.5" /></button>
    </form>;
  }

  function node(item: TreeNode): ReactNode {
    const expanded = opened.has(item.key);
    const renaming = editing?.key === item.key && editing.mode === "rename";
    const adding = editing?.key === item.key && editing.mode === "add";
    const editable = canManage && (item.depth !== 1 || isCategory(item));
    return <li key={item.key}>
      {renaming ? input(item.key, item.label, (value) => rename(item, value), "Tên mới") : (
        <div draggable={canManage && (item.depth === 0 || isCategory(item))} onDragStart={(event) => onDragStart(event, item)}
          onDragOver={(event) => { if (canManage && accepts(event)) { event.preventDefault(); setDropKey(item.key); } }} onDragLeave={() => setDropKey(null)} onDrop={(event) => onDrop(event, item)}
          className={cn("group flex items-center rounded", isActive(item) && "bg-indigo-100", dropKey === item.key && "ring-2 ring-indigo-400 bg-indigo-50")}>
          {item.children.length > 0
            ? <button type="button" aria-label={expanded ? "Thu" : "Mở"} aria-expanded={expanded} onClick={() => toggle(item.key)} className="rounded p-1 text-slate-400 hover:text-slate-700"><ChevronRight className={cn("size-3", expanded && "rotate-90")} /></button>
            : <span className="w-5" />}
          <button type="button" onClick={() => { onChoose(item.filter); setOpened((value) => new Set([...value, ...pathKeys(item.filter), item.key])); }}
            onDoubleClick={() => editable && setEditing({ key: item.key, mode: "rename", value: item.label })} title={editable ? "Bấm đúp để đổi tên" : undefined}
            className={cn("flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left text-xs", isActive(item) ? "font-semibold text-indigo-800" : "text-slate-700", item.hidden && "opacity-50")}>
            {item.depth < 2 ? <Folder className={cn("size-3.5 shrink-0", FOLDER_COLORS[item.depth])} /> : <FileText className="size-3.5 shrink-0 text-slate-400" />}
            <span className={cn("truncate", item.depth === 0 && "font-medium")}>{item.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-[11px] text-slate-400 group-hover:hidden">{item.count}</span>
          </button>
          {canManage && <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
            {editable && <button type="button" onClick={() => setEditing({ key: item.key, mode: "rename", value: item.label })} title="Đổi tên" aria-label={`Đổi tên ${item.label}`} className="rounded p-1 text-slate-400 hover:bg-white hover:text-indigo-700"><Pencil className="size-3" /></button>}
            {item.depth === 0 && <button type="button" onClick={() => { setOpened((value) => new Set([...value, item.key])); setEditing({ key: item.key, mode: "add", value: "" }); }} title="Thêm phân loại" aria-label={`Thêm phân loại vào ${item.label}`} className="rounded p-1 text-slate-400 hover:bg-white hover:text-indigo-700"><Plus className="size-3" /></button>}
            {(item.depth === 0 || isCategory(item)) && <button type="button" onClick={() => hide(item)} title={item.hidden ? "Hiện lại" : "Ẩn khỏi màn tạo content"} aria-label={item.hidden ? `Hiện ${item.label}` : `Ẩn ${item.label}`} className="rounded p-1 text-slate-400 hover:bg-white hover:text-indigo-700">{item.hidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}</button>}
            {(item.depth === 0 || isCategory(item)) && <GripVertical className="size-3 cursor-grab text-slate-300" aria-hidden />}
          </span>}
        </div>)}
      {(expanded || adding) && (item.children.length > 0 || adding) && <ul className="ml-3 border-l border-dotted border-slate-300 pl-1">
        {item.children.map(node)}
        {adding && <li>{input(item.key, "", (value) => value.trim() ? run(() => addFolder({ type: "category", department: item.filter.department!, name: value })) : setEditing(null), "Tên phân loại mới")}</li>}
      </ul>}
    </li>;
  }

  return <nav aria-label="Cây thư mục" className="min-w-0 border-b bg-slate-50/70 lg:border-b-0 lg:border-r">
    <div className="flex items-center justify-between border-b p-3 text-xs text-slate-500"><span>{total.toLocaleString("vi-VN")} {unit}</span>
      <span className="flex items-center gap-2"><button type="button" onClick={() => setOpened(new Set())} className="text-indigo-600">Thu gọn</button>
        {canManage && <button type="button" onClick={() => setEditing({ key: "__root", mode: "add", value: "" })} title="Thêm bộ phận" aria-label="Thêm bộ phận" className="inline-flex size-6 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><Plus className="size-3.5" /></button>}</span></div>
    <div className="max-h-[72vh] overflow-auto p-2">
      <button type="button" onClick={() => onChoose({})} className={cn("mb-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs", !active.department ? "bg-indigo-100 font-semibold text-indigo-800" : "text-slate-700 hover:bg-white")}><FolderOpen className="size-3.5 text-slate-500" />Tất cả {unit}<span className="ml-auto text-[11px] text-slate-400">{total}</span></button>
      <ul>{tree.map(node)}</ul>
      {editing?.key === "__root" && input("__root", "", (value) => value.trim() ? run(() => addFolder({ type: "department", name: value })) : setEditing(null), "Tên bộ phận mới")}
      {tree.length === 0 && <p className="p-4 text-sm text-slate-500">Không có {unit} phù hợp.</p>}
      {error && <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700" role="alert">{error}</p>}
    </div>
    {canManage && <p className="border-t p-3 text-[11px] leading-4 text-slate-400">Bấm đúp để đổi tên · kéo thư mục để sắp xếp · kéo bài từ danh sách thả vào thư mục để chuyển.</p>}
  </nav>;
}

/** "Chuyển tới…": the same move as dragging, from a list (keyboard and touch friendly). */
export function MoveToFolder({ tree, itemKind, itemId, onChanged }: { tree: TreeNode[]; itemKind: "template" | "content"; itemId: string; onChanged: (message: string) => void }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choices: Array<{ value: string; label: string; filter: TreeFilter }> = [];
  for (const department of tree) {
    choices.push({ value: department.key, label: department.label, filter: department.filter });
    for (const category of department.children) if (category.filter.category !== NO_CATEGORY) choices.push({ value: category.key, label: `${department.label} › ${category.label}`, filter: category.filter });
  }
  return <span className="inline-flex items-center gap-1">
    <select aria-label="Chuyển tới thư mục" value="" disabled={busy} onChange={(event) => {
      const choice = choices.find((item) => item.value === event.target.value);
      if (!choice) return;
      start(async () => {
        setError(null);
        const result = await moveToFolder({ kind: itemKind, id: itemId, to: { department: choice.filter.department, categoryId: choice.filter.category ?? null, format: null } }).catch(() => ({ ok: false as const, message: "Không chuyển được." }));
        if (result.ok) onChanged(result.message); else setError(result.message);
      });
    }} className="h-8 max-w-48 rounded-md border bg-white px-2 text-xs text-slate-700">
      <option value="">{busy ? "Đang chuyển…" : "Chuyển tới thư mục…"}</option>
      {choices.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    {error && <span className="text-xs text-rose-600">{error}</span>}
  </span>;
}
