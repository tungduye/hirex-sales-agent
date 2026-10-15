"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy, Eye, EyeOff, LoaderCircle, Pencil, Plus, Search, Tags, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContentTabs } from "@/modules/content/components/content-tabs";
import { copyText } from "@/modules/content/components/copy-text";
import { CONTENT_DEPARTMENTS, CONTENT_FORMATS, TEMPLATE_LANGUAGES, departmentLabel, formatLabel, languageLabel, type ContentDepartment } from "@/modules/content/core/content-options";
import { categoriesOf, type ContentCategory } from "@/modules/content/core/content-category";
import { addCategory, deleteCategory, renameCategory, setCategoryActive } from "@/modules/content/server/category-actions";
import { initialTemplateFormState } from "@/modules/content/core/content-state";
import { deleteTemplate, saveTemplate, setTemplateActive } from "@/modules/content/server/template-actions";
import type { ContentTemplate } from "@/modules/content/server/template-row";

const inputClass = "block w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60";

type Editing = { mode: "new" } | { mode: "edit"; template: ContentTemplate } | { mode: "view"; template: ContentTemplate };

export function TemplateLibraryView({ templates, categories, loadError, canManage }: { templates: ContentTemplate[]; categories: ContentCategory[]; loadError: string | null; canManage: boolean }) {
  const router = useRouter();
  const [department, setDepartmentState] = useState<ContentDepartment | "ALL">("ALL");
  const [format, setFormat] = useState<string>("ALL");
  const [category, setCategory] = useState<string>("ALL");
  const [language, setLanguage] = useState<string>("ALL");
  const [managingCategories, setManagingCategories] = useState(false);
  const setDepartment = (value: ContentDepartment | "ALL") => { setDepartmentState(value); setCategory("ALL"); };
  const categoryName = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);
  const categoryChoices = department === "ALL" ? categories : categoriesOf(categories, department, { includeInactive: true });
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useMemo(() => Object.fromEntries(CONTENT_DEPARTMENTS.map((item) => [item.value, templates.filter((template) => template.department === item.value && template.active).length])), [templates]);
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("vi");
    return templates.filter((template) =>
      (department === "ALL" || template.department === department)
      && (format === "ALL" || (template.format ?? "POST_LONG") === format)
      && (category === "ALL" || (category === "NONE" ? !template.categoryId : template.categoryId === category))
      && (language === "ALL" || template.language === language)
      && (status === "ALL" || (status === "ACTIVE") === template.active)
      && (!needle || [template.code, template.groupName, template.tags, template.body].some((value) => value?.toLocaleLowerCase("vi").includes(needle))));
  }, [templates, department, format, category, language, status, search]);

  const done = useCallback((message: string) => {
    setEditing(null);
    setNotice(message);
    router.refresh();
  }, [router]);

  const addButton = canManage ? <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setManagingCategories(true)}><Tags className="size-4" />Phân loại</Button><Button onClick={() => { setNotice(null); setEditing({ mode: "new" }); }}><Plus className="size-4" />Thêm mẫu</Button></div> : undefined;
  const selectClass = "h-10 rounded-lg border bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none";

  return (
    <>
      <PageHeader title="Kho content" description="Kho mẫu: các bài mẫu để AI học giọng văn, bố cục và CTA khi tạo content. Dữ kiện trong mẫu không bao giờ được dùng lại." action={addButton} />
      <ContentTabs active="/content/templates" />
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status">{notice}</div>}
      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-white p-8 text-center text-sm text-rose-700 shadow-sm">{loadError}</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b p-4">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Bộ phận">
              {[{ value: "ALL" as const, label: "Tất cả" }, ...CONTENT_DEPARTMENTS].map((item) => (
                <button key={item.value} type="button" role="tab" aria-selected={department === item.value} onClick={() => setDepartment(item.value)}
                  className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", department === item.value ? "border-blue-600 bg-blue-50 font-semibold text-blue-700" : "bg-white text-slate-600 hover:bg-slate-50")}>
                  {item.label}{item.value !== "ALL" && <span className="ml-1.5 text-xs text-slate-400">{counts[item.value]}</span>}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <select aria-label="Định dạng" value={format} onChange={(event) => setFormat(event.target.value)} className={selectClass}>
                <option value="ALL">Mọi định dạng</option>{CONTENT_FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <select aria-label="Phân loại" value={category} onChange={(event) => setCategory(event.target.value)} className={selectClass}>
                <option value="ALL">Mọi phân loại</option><option value="NONE">Chưa phân loại</option>
                {categoryChoices.map((item) => <option key={item.id} value={item.id}>{department === "ALL" ? `${departmentLabel(item.department)} · ` : ""}{item.name}{item.active ? "" : " (đã ẩn)"}</option>)}
              </select>
              <select aria-label="Ngôn ngữ" value={language} onChange={(event) => setLanguage(event.target.value)} className={selectClass}>
                <option value="ALL">Mọi ngôn ngữ</option>{TEMPLATE_LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" placeholder="Tìm theo mã, nhóm, tag, nội dung…" /></div>
              <select aria-label="Trạng thái" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 rounded-lg border bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none">
                <option value="ACTIVE">Đang dùng</option><option value="INACTIVE">Đã tắt</option><option value="ALL">Tất cả trạng thái</option>
              </select>
              <span className="text-xs font-medium text-slate-500 sm:ml-auto">{visible.length} mẫu</span>
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="px-5 py-14 text-center text-sm text-slate-500">{templates.length === 0 ? "Chưa có mẫu nào." : "Không có mẫu khớp bộ lọc."}</p>
          ) : (
            <ul className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((template) => (
                <li key={template.id}>
                  <button type="button" onClick={() => setEditing({ mode: "view", template })} className={cn("flex h-full w-full flex-col rounded-xl border p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40", !template.active && "opacity-60")}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="font-mono font-semibold text-blue-700">{template.code}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{departmentLabel(template.department)}</span>
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{formatLabel(template.format ?? "POST_LONG")}</span>
                      {template.categoryId && categoryName.get(template.categoryId) && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{categoryName.get(template.categoryId)}</span>}
                      <span className="text-slate-500">{languageLabel(template.language)}</span>
                      {!template.active && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">Đã tắt</span>}
                    </span>
                    {template.groupName && <span className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{template.groupName}</span>}
                    <span className="mt-1 line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{template.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {managingCategories && <CategoryManager categories={categories} onClose={() => setManagingCategories(false)} onChanged={() => router.refresh()} />}
      {editing?.mode === "view" && <TemplateDetail template={editing.template} categoryName={editing.template.categoryId ? categoryName.get(editing.template.categoryId) ?? null : null} canManage={canManage} onClose={() => setEditing(null)} onEdit={() => setEditing({ mode: "edit", template: editing.template })} onDone={done} />}
      {(editing?.mode === "new" || editing?.mode === "edit") && <TemplateForm template={editing.mode === "edit" ? editing.template : null} categories={categories} onClose={() => setEditing(null)} onSaved={done} />}
    </>
  );
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

function TemplateDetail({ template, categoryName, canManage, onClose, onEdit, onDone }: { template: ContentTemplate; categoryName: string | null; canManage: boolean; onClose: () => void; onEdit: () => void; onDone: (message: string) => void }) {
  const [busy, startAction] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startAction(async () => { const result = await action(); if (result.ok) onDone(result.message); else setError(result.message); });
  }

  const meta = [departmentLabel(template.department), formatLabel(template.format ?? "POST_LONG"), categoryName, languageLabel(template.language), template.groupName, template.tone && `Tone: ${template.tone}`, template.cta && `CTA: ${template.cta}`, `Trọng số ${template.weight}`].filter((value): value is string => Boolean(value));

  return (
    <Modal title={template.code} onClose={onClose} busy={busy}
      subtitle={<div className="mt-2 flex flex-wrap gap-1.5 text-xs">{meta.map((tag) => <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{tag}</span>)}</div>}
      footer={<>
        {canManage && (confirming
          ? <><span className="mr-auto text-sm text-rose-700">Xóa vĩnh viễn mẫu {template.code}?</span><Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Không</Button><Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={() => run(() => deleteTemplate(template.id))} disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Xóa</Button></>
          : <>
              <Button variant="ghost" size="sm" className="mr-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setConfirming(true)}><Trash2 className="size-4" />Xóa</Button>
              <Button variant="outline" size="sm" onClick={() => run(() => setTemplateActive(template.id, !template.active))} disabled={busy}>{template.active ? "Tắt mẫu" : "Bật mẫu"}</Button>
              <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>Sửa</Button>
            </>)}
        <Button size="sm" onClick={async () => { if (await copyText(template.body)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } else setError("Trình duyệt không cho phép sao chép. Hãy bôi đen và sao chép thủ công."); }}><Copy className="size-4" />{copied ? "Đã sao chép" : "Sao chép"}</Button>
      </>}>
      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{template.body}</div>
      {template.tags && <p className="mt-4 text-xs text-slate-500">Tags: {template.tags}</p>}
      {template.note && <p className="mt-1 text-xs text-slate-500">Ghi chú: {template.note}</p>}
      {error && <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
    </Modal>
  );
}

function TemplateForm({ template, categories, onClose, onSaved }: { template: ContentTemplate | null; categories: ContentCategory[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [state, formAction] = useActionState(saveTemplate, initialTemplateFormState);
  const [formDepartment, setFormDepartment] = useState<string>(template?.department ?? "SALE");
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
          <Field label="Định dạng" required error={error("contentFormat")}><select name="contentFormat" defaultValue={template?.format ?? "POST_LONG"} disabled={pending} className={cn(inputClass, "h-11")}>{CONTENT_FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Bộ phận" required error={error("department")}><select name="department" value={formDepartment} onChange={(event) => { setFormDepartment(event.target.value); setFormCategory(""); }} disabled={pending} className={cn(inputClass, "h-11")}>{CONTENT_DEPARTMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Phân loại" hint={departmentCategories.length ? undefined : "Bộ phận này chưa có phân loại (thêm ở nút Phân loại)."} error={error("categoryId")}><select name="categoryId" value={formCategory} onChange={(event) => setFormCategory(event.target.value)} disabled={pending || departmentCategories.length === 0} className={cn(inputClass, "h-11")}><option value="">Không phân loại</option>{departmentCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
          <Field label="Ngôn ngữ" required error={error("language")}><select name="language" defaultValue={template?.language ?? "VI"} disabled={pending} className={cn(inputClass, "h-11")}>{TEMPLATE_LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
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
function CategoryManager({ categories, onClose, onChanged }: { categories: ContentCategory[]; onClose: () => void; onChanged: () => void }) {
  const [busy, startAction] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    startAction(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) { after?.(); onChanged(); }
    });
  }

  return (
    <Modal title="Phân loại content" subtitle={<p className="mt-1 text-sm text-slate-500">Mỗi bộ phận có danh sách phân loại riêng. Phân loại bị ẩn vẫn giữ trên content cũ nhưng không hiện khi tạo mới.</p>} onClose={onClose} busy={busy}>
      <div className="space-y-5">
        {CONTENT_DEPARTMENTS.map((department) => {
          const list = categoriesOf(categories, department.value, { includeInactive: true });
          const draft = drafts[department.value] ?? "";
          return (
            <section key={department.value} className="rounded-xl border p-3">
              <h3 className="text-sm font-bold text-slate-800">{department.label}</h3>
              <ul className="mt-2 space-y-1">
                {list.length === 0 && <li className="text-xs text-slate-500">Chưa có phân loại.</li>}
                {list.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                    {editingId === item.id ? (
                      <form className="flex flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); run(() => renameCategory(item.id, editName), () => setEditingId(null)); }}>
                        <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={60} className={cn(inputClass, "h-8")} />
                        <Button type="submit" size="sm" disabled={busy}>Lưu</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)} disabled={busy}>Hủy</Button>
                      </form>
                    ) : confirmDelete === item.id ? (
                      <>
                        <span className="flex-1 text-rose-700">Xóa “{item.name}”? Mẫu và content đang gắn sẽ thành “chưa phân loại”.</span>
                        <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)} disabled={busy}>Không</Button>
                        <Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={() => run(() => deleteCategory(item.id), () => setConfirmDelete(null))} disabled={busy}>Xóa</Button>
                      </>
                    ) : (
                      <>
                        <span className={cn("flex-1", !item.active && "text-slate-400 line-through")}>{item.name}</span>
                        <button type="button" title="Đổi tên" aria-label={`Đổi tên ${item.name}`} onClick={() => { setEditingId(item.id); setEditName(item.name); }} disabled={busy} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="size-3.5" /></button>
                        <button type="button" title={item.active ? "Ẩn" : "Bật lại"} aria-label={`${item.active ? "Ẩn" : "Bật lại"} ${item.name}`} onClick={() => run(() => setCategoryActive(item.id, !item.active))} disabled={busy} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">{item.active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
                        <button type="button" title="Xóa" aria-label={`Xóa ${item.name}`} onClick={() => setConfirmDelete(item.id)} disabled={busy} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-3.5" /></button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); run(() => addCategory(department.value, draft), () => setDrafts((current) => ({ ...current, [department.value]: "" }))); }}>
                <input value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [department.value]: event.target.value }))} maxLength={60} placeholder={`Thêm phân loại cho ${department.label}`} className={cn(inputClass, "h-9")} />
                <Button type="submit" size="sm" variant="outline" disabled={busy || !draft.trim()}><Plus className="size-4" />Thêm</Button>
              </form>
            </section>
          );
        })}
        {message && <p className={cn("text-sm", message.ok ? "text-emerald-700" : "text-rose-700")} role="status">{message.text}</p>}
      </div>
    </Modal>
  );
}
