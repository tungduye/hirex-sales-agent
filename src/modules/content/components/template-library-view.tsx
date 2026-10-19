"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronRight, Copy, Eye, EyeOff, FileText, Folder, FolderOpen, LoaderCircle, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContentTabs } from "@/modules/content/components/content-tabs";
import { copyText } from "@/modules/content/components/copy-text";
import Link from "next/link";
import { buildContentTree, matchesFilter, NO_CATEGORY, pathKeys, type TreeFilter, type TreeNode } from "@/modules/content/core/content-tree";
import { useContentLists } from "@/modules/content/components/content-settings-context";
import { categoriesOf, type ContentCategory } from "@/modules/content/core/content-category";
import { initialTemplateFormState } from "@/modules/content/core/content-state";
import { deleteTemplate, saveTemplate, setTemplateActive } from "@/modules/content/server/template-actions";
import type { ContentTemplate } from "@/modules/content/server/template-row";

const inputClass = "block w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60";

type Editing = { mode: "new" } | { mode: "edit"; template: ContentTemplate };

const FOLDER_COLORS = ["text-rose-500", "text-orange-400", "text-sky-500"];

export function TemplateLibraryView({ templates, categories, loadError, canManage }: { templates: ContentTemplate[]; categories: ContentCategory[]; loadError: string | null; canManage: boolean }) {
  const router = useRouter();
  const lists = useContentLists();
  const { allLanguages, departmentLabel, formatLabel, languageLabel } = lists;
  const [filter, setFilter] = useState<TreeFilter>({});
  const [language, setLanguage] = useState<string>("ALL");
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const categoryName = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);

  // Search, language and status narrow the whole tree; the folder picks within it.
  const searched = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("vi");
    return templates.filter((template) => (language === "ALL" || template.language === language)
      && (status === "ALL" || (status === "ACTIVE") === template.active)
      && (!needle || [template.code, template.groupName, template.tags, template.body, template.note].some((value) => value?.toLocaleLowerCase("vi").includes(needle))));
  }, [templates, language, status, search]);
  const entries = useMemo(() => searched.map((template) => ({ department: template.department, categoryId: template.categoryId ?? null, format: template.format ?? null })), [searched]);
  const tree = useMemo(() => buildContentTree(entries, { departments: lists.settings.departments, formats: lists.settings.formats, categories }), [entries, lists.settings, categories]);
  const visible = useMemo(() => searched.filter((template) => matchesFilter({ department: template.department, categoryId: template.categoryId ?? null, format: template.format ?? null }, filter)), [searched, filter]);
  const selected = visible.find((template) => template.id === selectedId) ?? visible[0] ?? null;

  function choose(next: TreeFilter, key?: string) {
    setFilter(next); setSelectedId(null);
    if (key) setOpened((current) => new Set([...current, ...pathKeys(next), key]));
  }
  function toggle(key: string) { setOpened((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; }); }
  const done = useCallback((message: string) => { setEditing(null); setNotice(message); router.refresh(); }, [router]);
  const isActive = (node: TreeNode) => node.filter.department === filter.department && node.filter.category === filter.category && node.filter.format === filter.format;
  const folderName = filter.format ? formatLabel(filter.format) : filter.category ? (filter.category === NO_CATEGORY ? "Chưa phân loại" : categoryName.get(filter.category) ?? "") : filter.department ? departmentLabel(filter.department) : "Tất cả mẫu";

  function node(item: TreeNode): ReactNode {
    const expanded = opened.has(item.key);
    return <li key={item.key}>
      <div className={cn("flex items-center rounded", isActive(item) && "bg-indigo-100")}>
        {item.children.length > 0
          ? <button type="button" aria-label={expanded ? "Thu" : "Mở"} aria-expanded={expanded} onClick={() => toggle(item.key)} className="rounded p-1 text-slate-400 hover:text-slate-700"><ChevronRight className={cn("size-3", expanded && "rotate-90")} /></button>
          : <span className="w-5" />}
        <button type="button" onClick={() => choose(item.filter, item.key)} className={cn("flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left text-xs", isActive(item) ? "font-semibold text-indigo-800" : "text-slate-700", item.hidden && "opacity-60")}>
          {item.depth < 2 ? <Folder className={cn("size-3.5 shrink-0", FOLDER_COLORS[item.depth])} /> : <FileText className="size-3.5 shrink-0 text-slate-400" />}
          <span className={cn("truncate", item.depth === 0 && "font-medium")}>{item.label}</span>
          <span className="ml-auto shrink-0 tabular-nums text-[11px] text-slate-400">{item.count}</span>
        </button>
      </div>
      {expanded && item.children.length > 0 && <ul className="ml-3 border-l border-dotted border-slate-300 pl-1">{item.children.map(node)}</ul>}
    </li>;
  }

  const addButton = canManage ? <Button onClick={() => { setNotice(null); setEditing({ mode: "new" }); }}><Plus className="size-4" />Thêm mẫu</Button> : undefined;
  const selectClass = "h-9 rounded-lg border bg-white px-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none";

  return (
    <>
      <PageHeader title="Kho content" description="Kho mẫu: các bài mẫu để AI học giọng văn, bố cục và CTA khi tạo content. Dữ kiện trong mẫu không bao giờ được dùng lại." action={addButton} />
      <ContentTabs active="/content/templates" />
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status">{notice}</div>}
      {loadError ? <div className="rounded-xl border border-rose-200 bg-white p-8 text-center text-sm text-rose-700 shadow-sm">{loadError}</div> : (
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50/50 p-3">
            <div className="flex min-w-60 flex-1 items-center gap-2 rounded-xl border bg-white px-3 focus-within:border-indigo-400"><Search className="size-4 shrink-0 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Tìm mẫu" placeholder="Tìm theo mã, nhóm, tag, nội dung…" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" /></div>
            <select aria-label="Ngôn ngữ" value={language} onChange={(event) => setLanguage(event.target.value)} className={selectClass}><option value="ALL">Mọi ngôn ngữ</option>{allLanguages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            <select aria-label="Trạng thái" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={selectClass}><option value="ACTIVE">Đang dùng</option><option value="INACTIVE">Đã tắt</option><option value="ALL">Mọi trạng thái</option></select>
          </div>
          <div className="grid lg:grid-cols-[260px_minmax(0,1fr)]">
            <nav aria-label="Cây thư mục mẫu" className="min-w-0 border-b bg-slate-50/70 lg:border-b-0 lg:border-r">
              <div className="flex items-center justify-between border-b p-3 text-xs text-slate-500">
                <span>{searched.length.toLocaleString("vi-VN")} mẫu</span>
                <span className="flex items-center gap-2"><button type="button" onClick={() => setOpened(new Set())} className="text-indigo-600">Thu gọn</button>
                  {canManage && <Link href="/content/settings" title="Thêm bộ phận / phân loại" aria-label="Thêm bộ phận hoặc phân loại" className="inline-flex size-6 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><Plus className="size-3.5" /></Link>}</span>
              </div>
              <div className="max-h-[72vh] overflow-auto p-2">
                <button type="button" onClick={() => choose({})} className={cn("mb-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs", !filter.department ? "bg-indigo-100 font-semibold text-indigo-800" : "text-slate-700 hover:bg-white")}><FolderOpen className="size-3.5 text-slate-500" />Tất cả mẫu<span className="ml-auto text-[11px] text-slate-400">{searched.length}</span></button>
                <ul>{tree.map(node)}</ul>
                {tree.length === 0 && <p className="p-4 text-sm text-slate-500">Không có mẫu phù hợp.</p>}
              </div>
            </nav>
            <div className="min-w-0">
              <div className="border-b px-4 py-2.5 text-xs text-slate-500"><span className="font-semibold text-slate-700">{folderName}</span> · {visible.length} mẫu</div>
              <ul className="max-h-64 divide-y overflow-y-auto border-b">
                {visible.map((template) => <li key={template.id}><button type="button" onClick={() => setSelectedId(template.id)} className={cn("block w-full px-4 py-2.5 text-left", selected?.id === template.id ? "bg-indigo-50" : "hover:bg-slate-50", !template.active && "opacity-60")}>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs"><span className="font-mono font-semibold text-blue-700">{template.code}</span>
                    {template.groupName && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{template.groupName}</span>}
                    <span className="text-slate-500">{languageLabel(template.language)}</span>{!template.active && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">Đã tắt</span>}</span>
                  <span className="mt-0.5 block truncate text-sm text-slate-700">{template.body.split("\n").find((line) => line.trim())}</span>
                </button></li>)}
                {visible.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">{templates.length === 0 ? "Chưa có mẫu nào." : "Không có mẫu trong thư mục này."}</li>}
              </ul>
              <article className="p-5">{selected ? <>
                <p className="font-mono text-xs font-semibold text-indigo-600">{selected.code}</p>
                <TemplateActions key={selected.id} template={selected} canManage={canManage} onEdit={() => setEditing({ mode: "edit", template: selected })} onDone={done} />
                <div className="mt-3 flex flex-wrap gap-1.5 text-xs">{[departmentLabel(selected.department), formatLabel(selected.format ?? "POST_LONG"), selected.categoryId ? categoryName.get(selected.categoryId) : null, languageLabel(selected.language)].filter(Boolean).map((tag) => <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{tag}</span>)}</div>
                <div className="mt-4 max-h-[55vh] overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-800">{selected.body}</div>
                <TemplateInfo template={selected} />
              </> : <p className="py-16 text-center text-sm text-slate-400">Chọn một mẫu để đọc.</p>}</article>
            </div>
          </div>
        </div>
      )}
      {editing && <TemplateForm template={editing.mode === "edit" ? editing.template : null} categories={categories} onClose={() => setEditing(null)} onSaved={done} />}
    </>
  );
}

function TemplateActions({ template, canManage, onEdit, onDone }: { template: ContentTemplate; canManage: boolean; onEdit: () => void; onDone: (message: string) => void }) {
  const [busy, startAction] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startAction(async () => { const result = await action(); if (result.ok) onDone(result.message); else setError(result.message); });
  }
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={async () => { if (await copyText(template.body)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } else setError("Trình duyệt không cho phép sao chép."); }}><Copy className="size-4" />{copied ? "Đã sao chép" : "Sao chép"}</Button>
        <Button size="sm" variant="outline" asChild><Link href={`/content/new?template=${template.id}`}><Sparkles className="size-4" />Tạo content từ mẫu này</Link></Button>
        {canManage && <>
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}><Pencil className="size-4" />Sửa</Button>
          <Button size="sm" variant="outline" onClick={() => run(() => setTemplateActive(template.id, !template.active))} disabled={busy}>{template.active ? <><EyeOff className="size-4" />Tắt mẫu</> : <><Eye className="size-4" />Bật mẫu</>}</Button>
          {confirming
            ? <span className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2 text-xs text-rose-700">Xóa vĩnh viễn {template.code}?<Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Không</Button><Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={() => run(() => deleteTemplate(template.id))} disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Xóa</Button></span>
            : <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setConfirming(true)}><Trash2 className="size-4" />Xóa</Button>}
        </>}
      </div>
      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700" role="alert">{error}</p>}
    </div>
  );
}

function TemplateInfo({ template }: { template: ContentTemplate }) {
  const info = [template.groupName && `Nhóm: ${template.groupName}`, template.tone && `Tone: ${template.tone}`, template.cta && `CTA: ${template.cta}`, `Trọng số ${template.weight}`, template.tags && `Tags: ${template.tags}`, template.note && `Ghi chú: ${template.note}`].filter((value): value is string => Boolean(value));
  return info.length ? <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-slate-500">{info.map((line) => <li key={line} className="break-words">{line}</li>)}</ul> : null;
}

function Modal({ title, subtitle, onClose, busy, children, footer }: { title: string; subtitle?: ReactNode; onClose: () => void; busy: boolean; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="template-modal-title">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Đóng" onClick={onClose} disabled={busy} />
      <div className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div className="min-w-0"><h2 id="template-modal-title" className="text-lg font-bold tracking-tight">{title}</h2>{subtitle}</div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Đóng"><X className="size-5" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

function TemplateForm({ template, categories, onClose, onSaved }: { template: ContentTemplate | null; categories: ContentCategory[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [state, formAction] = useActionState(saveTemplate, initialTemplateFormState);
  const lists = useContentLists();
  // Entries switched off in Cài đặt are not offered, except the value this template already has.
  const keep = (choices: { value: string; label: string }[], value: string | null | undefined, label: (value: string) => string) =>
    value && !choices.some((item) => item.value === value) ? [...choices, { value, label: `${label(value)} (đã ẩn)` }] : choices;
  const formatChoices = keep(lists.formats, template?.format, lists.formatLabel);
  const departmentChoices = keep(lists.departments, template?.department, lists.departmentLabel);
  const languageChoices = keep(lists.languages, template?.language, lists.languageLabel);
  const [formDepartment, setFormDepartment] = useState<string>(template?.department ?? departmentChoices[0]?.value ?? "SALE");
  const [formCategory, setFormCategory] = useState<string>(template?.categoryId ?? "");
  const departmentCategories = categoriesOf(categories, formDepartment).concat(categories.filter((item) => item.id === template?.categoryId && !item.active && item.department === formDepartment));
  const [pending, startTransition] = useTransition();

  useEffect(() => { if (state.success && state.message) onSaved(state.message); }, [state, onSaved]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }
  const error = (name: string) => state.fieldErrors?.[name]?.[0];

  return (
    <Modal title={template ? `Sửa mẫu ${template.code}` : "Thêm mẫu"} subtitle={<p className="mt-1 text-sm text-slate-500">Dán bài mẫu đã được duyệt. AI chỉ học giọng văn, bố cục và CTA từ mẫu.</p>} onClose={onClose} busy={pending}>
      <form id="template-form" onSubmit={submit} className="space-y-4">
        {template && <input type="hidden" name="templateId" value={template.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Định dạng" required error={error("contentFormat")}><select name="contentFormat" defaultValue={template?.format ?? "POST_LONG"} disabled={pending} className={cn(inputClass, "h-11")}>{formatChoices.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Bộ phận" required error={error("department")}><select name="department" value={formDepartment} onChange={(event) => { setFormDepartment(event.target.value); setFormCategory(""); }} disabled={pending} className={cn(inputClass, "h-11")}>{departmentChoices.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Phân loại" hint={departmentCategories.length ? undefined : "Bộ phận này chưa có phân loại (thêm ở tab Cài đặt)."} error={error("categoryId")}><select name="categoryId" value={formCategory} onChange={(event) => setFormCategory(event.target.value)} disabled={pending || departmentCategories.length === 0} className={cn(inputClass, "h-11")}><option value="">Không phân loại</option>{departmentCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Ngôn ngữ" required error={error("language")}><select name="language" defaultValue={template?.language ?? "VI"} disabled={pending} className={cn(inputClass, "h-11")}>{languageChoices.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Nhóm mẫu" error={error("groupName")}><input name="groupName" defaultValue={template?.groupName ?? ""} maxLength={100} disabled={pending} placeholder="VD: SHORT_TEASER, BENEFIT_FIRST" className={cn(inputClass, "h-11")} /></Field>
          <Field label="Trọng số (1–10)" hint="Mẫu trọng số cao được ưu tiên khi tự chọn." error={error("weight")}><input name="weight" type="number" min={1} max={10} defaultValue={template?.weight ?? 3} disabled={pending} className={cn(inputClass, "h-11 sm:w-32")} /></Field>
          <Field label="Tone" error={error("tone")}><input name="tone" defaultValue={template?.tone ?? ""} maxLength={200} disabled={pending} placeholder="Recruiter gần gũi, trực tiếp" className={cn(inputClass, "h-11")} /></Field>
          <Field label="CTA hướng tới" error={error("cta")}><input name="cta" defaultValue={template?.cta ?? ""} maxLength={200} disabled={pending} placeholder="IB / chấm (.) / gửi CV" className={cn(inputClass, "h-11")} /></Field>
        </div>
        <Field label="Nội dung mẫu" required error={error("body")}><textarea name="body" required rows={10} maxLength={8000} defaultValue={template?.body ?? ""} disabled={pending} className={cn(inputClass, "py-2 leading-6")} /></Field>
        <Field label="Tags" error={error("tags")}><input name="tags" defaultValue={template?.tags ?? ""} maxLength={500} disabled={pending} placeholder="Salary First;Urgent;Senior" className={cn(inputClass, "h-11")} /></Field>
        <Field label="Ghi chú" error={error("note")}><input name="note" defaultValue={template?.note ?? ""} maxLength={1000} disabled={pending} placeholder="Mẫu này dạy điều gì" className={cn(inputClass, "h-11")} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" name="active" defaultChecked={template?.active ?? true} disabled={pending} className="size-4 accent-blue-600" />Đang dùng (hiện trong popup Tạo content)</label>
        {state.message && !state.success && <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{state.message}</div>}
        <div className="flex justify-end gap-3 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Hủy</Button>
          <Button type="submit" disabled={pending}>{pending ? <><LoaderCircle className="size-4 animate-spin" />Đang lưu…</> : "Lưu mẫu"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="block text-sm font-semibold text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

/** "Phân loại" per department: add, rename, hide (kept on existing content) or delete. */
