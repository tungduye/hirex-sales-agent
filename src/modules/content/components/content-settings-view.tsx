"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, EyeOff, LoaderCircle, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContentTabs } from "@/modules/content/components/content-tabs";
import { categoriesOf, type ContentCategory } from "@/modules/content/core/content-category";
import { contentCodePrefix, findOption, OPTION_KIND_LABEL, optionsOf, suggestAbbr, wordRangeLabel, type ContentOption, type ContentSettings, type OptionKind } from "@/modules/content/core/content-settings";
import { moveContentOption, saveContentCategory, saveContentOption, type SettingsActionResult } from "@/modules/content/server/content-settings-actions";

type Tab = "DEPARTMENT" | "FORMAT" | "LANGUAGE" | "STYLE";
const TABS: { value: Tab; label: string }[] = [
  { value: "DEPARTMENT", label: "Bộ phận & Phân loại" }, { value: "FORMAT", label: "Định dạng" }, { value: "LANGUAGE", label: "Ngôn ngữ" }, { value: "STYLE", label: "Phong cách" },
];
type Selected =
  | { type: "option"; kind: OptionKind; code: string } | { type: "newOption"; kind: OptionKind }
  | { type: "category"; id: string } | { type: "newCategory"; department: string } | null;

const inputClass = "block w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60";

export function ContentSettingsView({ settings, categories, canManage }: { settings: ContentSettings; categories: ContentCategory[]; canManage: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("DEPARTMENT");
  const [selected, setSelected] = useState<Selected>({ type: "option", kind: "DEPARTMENT", code: settings.departments[0]?.code ?? "REC" });
  const [notice, setNotice] = useState<string | null>(null);
  const [moving, startMove] = useTransition();
  const list = optionsOf(settings, tab);

  function changeTab(next: Tab) {
    setTab(next); setNotice(null);
    const first = optionsOf(settings, next)[0];
    setSelected(first ? { type: "option", kind: next, code: first.code } : null);
  }
  function saved(result: SettingsActionResult, next: Selected) {
    if (!result.ok) return;
    setNotice(result.message); setSelected(next); router.refresh();
  }
  function move(code: string, direction: -1 | 1) {
    startMove(async () => { const result = await moveContentOption(tab, code, direction); if (result.ok) router.refresh(); else setNotice(result.message); });
  }

  const add = (label: string, onClick: () => void) => canManage
    ? <button type="button" onClick={onClick} title={label} aria-label={label} className="inline-flex size-7 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"><Plus className="size-4" /></button>
    : null;

  return (
    <>
      <PageHeader title="Kho content" description="Cài đặt: bộ phận, phân loại, định dạng, ngôn ngữ và phong cách dùng khi tạo content. Mã viết tắt tạo nên mã content, ví dụ 261019_REC_DCT_GT_VI_01." />
      <ContentTabs active="/content/settings" showSettings />
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status">{notice}</div>}
      {!canManage && <p className="mb-4 rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-600">Bạn chỉ xem được. Cần quyền “Quản lý kho mẫu” để sửa.</p>}
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Hạng mục">
        {TABS.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} onClick={() => changeTab(item.value)}
          className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", tab === item.value ? "border-blue-600 bg-blue-50 font-semibold text-blue-700" : "bg-white text-slate-600 hover:bg-slate-50")}>{item.label}</button>)}
      </div>
      <div className="grid items-start gap-4 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{tab === "DEPARTMENT" ? "Bộ phận" : TABS.find((item) => item.value === tab)?.label}</p>
            {add(`Thêm ${TABS.find((item) => item.value === tab)?.label.toLowerCase()}`, () => { setNotice(null); setSelected({ type: "newOption", kind: tab }); })}
          </div>
          <ul className="max-h-[70vh] overflow-y-auto p-2">
            {list.map((option, index) => (
              <li key={option.code}>
                <div className={cn("group flex items-center gap-1 rounded-lg pr-1", isSelected(selected, option) && "bg-blue-50")}>
                  <button type="button" onClick={() => { setNotice(null); setSelected({ type: "option", kind: tab, code: option.code }); }} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm">
                    {tab === "DEPARTMENT" && <ChevronRight className="size-3.5 shrink-0 text-slate-400" />}
                    <span className={cn("min-w-0 font-semibold leading-5", option.active ? "text-slate-900" : "text-slate-400")}>{option.label}</span>
                    {option.abbr && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{option.abbr}</span>}
                    {!option.active && <EyeOff className="size-3.5 shrink-0 text-slate-400" aria-label="Đã ẩn" />}
                    {tab === "FORMAT" && wordRangeLabel(option) && <span className="ml-auto shrink-0 text-xs text-slate-400">{wordRangeLabel(option)}</span>}
                  </button>
                  {canManage && <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" disabled={moving || index === 0} onClick={() => move(option.code, -1)} aria-label={`Đưa ${option.label} lên`} className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" disabled={moving || index === list.length - 1} onClick={() => move(option.code, 1)} aria-label={`Đưa ${option.label} xuống`} className="rounded p-1 text-slate-500 hover:bg-white disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                  </span>}
                </div>
                {tab === "DEPARTMENT" && <ul className="mb-1 ml-6 border-l pl-2">
                  {categoriesOf(categories, option.code, { includeInactive: true }).map((category) => (
                    <li key={category.id}><button type="button" onClick={() => { setNotice(null); setSelected({ type: "category", id: category.id }); }}
                      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", selected?.type === "category" && selected.id === category.id ? "bg-violet-50 text-violet-800" : "text-slate-600 hover:bg-slate-50", !category.active && "text-slate-400")}>
                      <span className="truncate">{category.name}</span>
                      {category.abbr && <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[11px] text-violet-700">{category.abbr}</span>}
                      {!category.active && <EyeOff className="size-3.5 shrink-0" aria-label="Đã ẩn" />}
                    </button></li>
                  ))}
                  {canManage && <li><button type="button" onClick={() => { setNotice(null); setSelected({ type: "newCategory", department: option.code }); }} className="flex items-center gap-1 px-2 py-1.5 text-xs font-semibold text-blue-700 hover:underline"><Plus className="size-3.5" />Phân loại</button></li>}
                </ul>}
              </li>
            ))}
          </ul>
        </aside>
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          {selected?.type === "option" || selected?.type === "newOption"
            ? <OptionForm key={selected.type === "option" ? `${selected.kind}:${selected.code}` : `new:${selected.kind}`} kind={selected.kind}
                option={selected.type === "option" ? findOption(optionsOf(settings, selected.kind), selected.code) : null} settings={settings} canManage={canManage}
                onSaved={(result) => saved(result, result.ok && result.code ? { type: "option", kind: selected.kind, code: result.code } : selected)} />
            : selected?.type === "category" || selected?.type === "newCategory"
              ? <CategoryForm key={selected.type === "category" ? selected.id : `new:${selected.department}`} settings={settings}
                  category={selected.type === "category" ? categories.find((item) => item.id === selected.id) ?? null : null}
                  department={selected.type === "category" ? categories.find((item) => item.id === selected.id)?.department ?? "REC" : selected.department} canManage={canManage}
                  onSaved={(result) => saved(result, result.ok && result.id ? { type: "category", id: result.id } : selected)} />
              : <p className="py-16 text-center text-sm text-slate-500">Chọn một mục bên trái để xem hoặc sửa.</p>}
        </section>
      </div>
    </>
  );
}

function isSelected(selected: Selected, option: ContentOption) {
  return selected?.type === "option" && selected.kind === option.kind && selected.code === option.code;
}

function useSave(onSaved: (result: SettingsActionResult) => void) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = useState<string | null>(null);
  function run(action: () => Promise<SettingsActionResult>) {
    setMessage(null); setErrors({});
    start(async () => {
      const result = await action().catch(() => ({ ok: false as const, message: "Không lưu được, thử lại sau." }));
      if (!result.ok) { setMessage(result.message); setErrors(("fieldErrors" in result && result.fieldErrors) || {}); }
      onSaved(result);
    });
  }
  return { pending, errors, message, run };
}

function OptionForm({ kind, option, settings, canManage, onSaved }: { kind: OptionKind; option: ContentOption | null; settings: ContentSettings; canManage: boolean; onSaved: (result: SettingsActionResult) => void }) {
  const [label, setLabel] = useState(option?.label ?? "");
  const [abbr, setAbbr] = useState(option?.abbr ?? "");
  const [abbrTouched, setAbbrTouched] = useState(Boolean(option));
  const [wordMin, setWordMin] = useState(option?.wordMin?.toString() ?? "");
  const [wordMax, setWordMax] = useState(option?.wordMax?.toString() ?? "");
  const [guide, setGuide] = useState(option?.guide ?? "");
  const [active, setActive] = useState(option?.active ?? true);
  const { pending, errors, message, run } = useSave(onSaved);
  const disabled = pending || !canManage;
  const kindLabel = OPTION_KIND_LABEL[kind];
  const preview = useMemo(() => {
    if (kind === "STYLE" || !abbr) return null;
    const override = { ...settings, [kind === "DEPARTMENT" ? "departments" : kind === "FORMAT" ? "formats" : "languages"]: [{ ...(option ?? {}), code: "__", abbr } as ContentOption] };
    return contentCodePrefix({ date: new Date(), department: kind === "DEPARTMENT" ? "__" : "REC", format: kind === "FORMAT" ? "__" : "POST_LONG", categoryAbbr: "GT", language: kind === "LANGUAGE" ? "__" : "VI" }, override as ContentSettings) + "_01";
  }, [kind, abbr, option, settings]);

  return (
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); run(() => saveContentOption({ kind, code: option?.code ?? "", label, abbr, active,
      wordMin: wordMin ? Number(wordMin) : null, wordMax: wordMax ? Number(wordMax) : null, guide })); }}>
      <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{option ? kindLabel : `Thêm ${kindLabel.toLowerCase()}`}</p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">{option?.label || "Mục mới"}</h2>
        {option?.builtIn && <p className="mt-1 text-xs text-slate-500">Mục có sẵn: đổi được tên, mã viết tắt, ẩn hoặc hiện.</p>}</div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
        <Field label="Tên hiển thị" error={errors.label?.[0]}><input value={label} onChange={(event) => { setLabel(event.target.value); if (!abbrTouched && kind !== "STYLE") setAbbr(suggestAbbr(event.target.value)); }} maxLength={60} required disabled={disabled} className={cn(inputClass, "h-10")} /></Field>
        {kind !== "STYLE" && <Field label="Mã viết tắt" hint="Dùng trong mã content" error={errors.abbr?.[0]}><input value={abbr} onChange={(event) => { setAbbrTouched(true); setAbbr(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); }} maxLength={8} required disabled={disabled} className={cn(inputClass, "h-10 font-mono uppercase")} /></Field>}
      </div>
      {kind === "FORMAT" && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Số chữ tối thiểu (mỗi ngôn ngữ)" error={errors.wordMin?.[0]}><input type="number" min={1} max={2000} value={wordMin} onChange={(event) => setWordMin(event.target.value)} required disabled={disabled} className={cn(inputClass, "h-10")} /></Field>
        <Field label="Số chữ tối đa" error={errors.wordMax?.[0]}><input type="number" min={1} max={3000} value={wordMax} onChange={(event) => setWordMax(event.target.value)} required disabled={disabled} className={cn(inputClass, "h-10")} /></Field>
      </div>}
      {(kind === "DEPARTMENT" || kind === "FORMAT") && <Field label="Ghi chú cho AI" hint={kind === "DEPARTMENT" ? "Ai đọc, mục tiêu, giọng văn, lời kêu gọi. Bộ phận có sẵn đã có hướng dẫn riêng; ghi chú này được thêm vào." : "Cách viết riêng của định dạng này (ví dụ: không hashtag, có lời chào)."} error={errors.guide?.[0]}>
        <textarea value={guide} onChange={(event) => setGuide(event.target.value)} rows={3} maxLength={1000} disabled={disabled} className={cn(inputClass, "py-2")} /></Field>}
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={disabled} className="size-4 accent-blue-600" />Đang dùng (bỏ chọn để ẩn khỏi màn tạo content; content cũ giữ nguyên)</label>
      {preview && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Mã content sẽ có dạng <span className="font-mono font-semibold text-slate-800">{preview.replace("__", abbr)}</span></p>}
      {message && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{message}</p>}
      {canManage && <div className="flex justify-end border-t pt-4"><Button type="submit" disabled={pending}>{pending && <LoaderCircle className="size-4 animate-spin" />}{option ? "Lưu" : "Thêm"}</Button></div>}
    </form>
  );
}

function CategoryForm({ category, department, settings, canManage, onSaved }: { category: ContentCategory | null; department: string; settings: ContentSettings; canManage: boolean; onSaved: (result: SettingsActionResult) => void }) {
  const [name, setName] = useState(category?.name ?? "");
  const [abbr, setAbbr] = useState(category?.abbr ?? "");
  const [abbrTouched, setAbbrTouched] = useState(Boolean(category?.abbr));
  const [guide, setGuide] = useState(category?.guide ?? "");
  const [active, setActive] = useState(category?.active ?? true);
  const { pending, errors, message, run } = useSave(onSaved);
  const disabled = pending || !canManage;
  const departmentLabel = findOption(settings.departments, department)?.label ?? department;
  const preview = abbr ? `${contentCodePrefix({ date: new Date(), department, format: "POST_LONG", categoryAbbr: abbr, language: "VI" }, settings)}_01` : null;

  return (
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); run(() => saveContentCategory({ id: category?.id ?? "", department, name, abbr, active, guide })); }}>
      <div><p className="text-xs font-bold uppercase tracking-wide text-violet-600">Phân loại · {departmentLabel}</p><h2 className="mt-1 text-xl font-bold text-slate-900">{category?.name || "Phân loại mới"}</h2></div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
        <Field label="Tên phân loại" error={errors.name?.[0]}><input value={name} onChange={(event) => { setName(event.target.value); if (!abbrTouched) setAbbr(suggestAbbr(event.target.value)); }} maxLength={60} required disabled={disabled} className={cn(inputClass, "h-10")} /></Field>
        <Field label="Mã viết tắt" hint="Dùng trong mã content" error={errors.abbr?.[0]}><input value={abbr} onChange={(event) => { setAbbrTouched(true); setAbbr(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")); }} maxLength={8} required disabled={disabled} className={cn(inputClass, "h-10 font-mono uppercase")} /></Field>
      </div>
      <Field label="Ghi chú cho AI" hint="Cách viết dạng bài này, ví dụ “Dạng share: viết như người chia sẻ lại, không quảng cáo”." error={errors.guide?.[0]}>
        <textarea value={guide} onChange={(event) => setGuide(event.target.value)} rows={3} maxLength={1000} disabled={disabled} className={cn(inputClass, "py-2")} /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={disabled} className="size-4 accent-blue-600" />Đang dùng (bỏ chọn để ẩn; content và mẫu cũ giữ nguyên)</label>
      {preview && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Mã content sẽ có dạng <span className="font-mono font-semibold text-slate-800">{preview}</span></p>}
      {message && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{message}</p>}
      {canManage && <div className="flex justify-end border-t pt-4"><Button type="submit" disabled={pending}>{pending && <LoaderCircle className="size-4 animate-spin" />}{category ? "Lưu" : "Thêm"}</Button></div>}
    </form>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="block text-sm font-semibold text-slate-700">{label}</span>{children}
    {hint && <span className="block text-xs text-slate-500">{hint}</span>}{error && <span className="block text-xs text-rose-600">{error}</span>}</label>;
}
