"use client";

import { useRef, useState } from "react";
import { BookOpen, ExternalLink, LoaderCircle, X } from "lucide-react";
import { CONTENT_DEPARTMENTS, CONTENT_FORMATS, CONTENT_LANGUAGES, formatLabel, languageLabel } from "@/modules/content/core/content-options";
import { categoriesOf, type ContentCategory } from "@/modules/content/core/content-category";
import { emailHtmlOf, messageTextOf, type PickedContent } from "@/modules/content/core/campaign-content";


const selectClass = "h-9 rounded-lg border bg-white px-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none";

/**
 * "Lấy từ Kho content": finds unused library content by label and fills the campaign. The chosen ids
 * travel with the form ("contentItemIds") so saving the campaign marks them used — each content
 * serves one campaign only.
 *  - mode "message": calls onFill with one text per content (Zalo / Facebook variants).
 *  - mode "email": fills the form's "subject" field and the rich editor (name "bodyHtml").
 */
export function CampaignContentPicker({ mode, defaultFormat, max, onFill }: { mode: "message" | "email"; defaultFormat: string; max: number; onFill?: (texts: string[]) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState(defaultFormat);
  const [department, setDepartment] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [quantity, setQuantity] = useState(Math.min(max, mode === "email" ? 1 : 3));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PickedContent[] | null>(null);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [used, setUsed] = useState<PickedContent[]>([]);

  async function search() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (format) params.set("format", format);
      if (department) params.set("dept", department);
      if (category) params.set("cat", category);
      if (language) params.set("lang", language);
      const response = await fetch(`/api/content/available?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { items: PickedContent[]; categories: ContentCategory[] };
      setResults(payload.items); setCategories(payload.categories);
      setChecked(new Set(payload.items.slice(0, quantity).map((item) => item.id)));
    } catch { setError("Không tải được Kho content. Kiểm tra quyền xem Kho content rồi thử lại."); }
    finally { setLoading(false); }
  }

  function fill() {
    const chosen = (results ?? []).filter((item) => checked.has(item.id)).slice(0, max);
    if (chosen.length === 0) return;
    if (mode === "message") onFill?.(chosen.map(messageTextOf));
    else {
      const form = rootRef.current?.closest("form");
      const subject = form?.elements.namedItem("subject");
      if (subject instanceof HTMLInputElement) { subject.value = chosen[0].title.slice(0, 998); subject.dispatchEvent(new Event("input", { bubbles: true })); }
      window.dispatchEvent(new CustomEvent("hirex:email-editor-fill", { detail: { name: "bodyHtml", html: emailHtmlOf(chosen[0].body) } }));
    }
    setUsed(chosen); setOpen(false);
  }

  const departmentCategories = department ? categoriesOf(categories, department) : [];
  const missing = results && results.length < quantity;
  const libraryHref = `/content?${new URLSearchParams({ ...(format ? { format } : {}), ...(department ? { dept: department } : {}), ...(category ? { cat: category } : {}), ...(language ? { lang: language } : {}) })}`;

  return <div ref={rootRef} className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
    {used.map((item) => <input key={item.id} type="hidden" name="contentItemIds" value={item.id} />)}
    <div className="flex flex-wrap items-center gap-2">
      <BookOpen className="size-4 text-violet-700" />
      <p className="text-sm font-semibold text-violet-900">Lấy từ Kho content</p>
      {used.length > 0 ? <span className="text-xs text-violet-800">Đã điền {used.length} content: {used.map((item) => item.code).join(", ")} — đánh dấu đã dùng khi lưu chiến dịch.</span> : <span className="text-xs text-slate-500">Chỉ hiện content chưa dùng cho chiến dịch nào.</span>}
      <div className="ml-auto flex gap-1.5">
        {used.length > 0 && <button type="button" onClick={() => setUsed([])} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-white hover:text-rose-600" title="Không gắn các content này với chiến dịch (nội dung đã điền vẫn giữ)">Bỏ liên kết</button>}
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-50">{open ? "Đóng" : used.length ? "Chọn lại" : "Chọn content"}</button>
      </div>
    </div>
    {open && <div className="mt-3 space-y-3 rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-slate-600">Định dạng<br /><select value={format} onChange={(event) => setFormat(event.target.value)} className={selectClass}><option value="">Mọi định dạng</option>{CONTENT_FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Bộ phận<br /><select value={department} onChange={(event) => { setDepartment(event.target.value); setCategory(""); }} className={selectClass}><option value="">Mọi bộ phận</option>{CONTENT_DEPARTMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Phân loại<br /><select value={category} onChange={(event) => setCategory(event.target.value)} disabled={!department} className={selectClass}><option value="">{department ? "Mọi phân loại" : "Chọn bộ phận trước"}</option>{departmentCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Ngôn ngữ<br /><select value={language} onChange={(event) => setLanguage(event.target.value)} className={selectClass}><option value="">Mọi ngôn ngữ</option>{CONTENT_LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        {max > 1 && <label className="text-xs font-semibold text-slate-600">Số lượng<br /><input type="number" min={1} max={max} value={quantity} onChange={(event) => setQuantity(Math.min(max, Math.max(1, Number(event.target.value) || 1)))} className={`${selectClass} w-20`} /></label>}
        <button type="button" onClick={() => void search()} disabled={loading} className="h-9 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-60">{loading ? <LoaderCircle className="size-4 animate-spin" /> : "Tìm content"}</button>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {results && <>
        {missing && <p className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Kho chỉ còn {results.length} content chưa dùng khớp bộ lọc (cần {quantity}).<a href={libraryHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-amber-900 underline">Tạo thêm ở Kho content <ExternalLink className="size-3" /></a></p>}
        {results.length > 0 && <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {results.map((item) => <li key={item.id}><label className="flex cursor-pointer gap-2 rounded-lg border p-2.5 hover:bg-slate-50">
            <input type={mode === "email" ? "radio" : "checkbox"} name={mode === "email" ? "content-picker-choice" : undefined} checked={checked.has(item.id)} onChange={(event) => setChecked((current) => { if (mode === "email") return new Set([item.id]); const next = new Set(current); if (event.target.checked) { if (next.size < max) next.add(item.id); } else next.delete(item.id); return next; })} className="mt-1 size-4 accent-violet-700" />
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5 text-xs"><span className="font-mono font-semibold text-blue-700">{item.code}</span><span className="rounded bg-slate-100 px-1.5 text-slate-600">{formatLabel(item.content_format)}</span><span className="text-slate-500">{languageLabel(item.content_language)}</span></span><span className="mt-0.5 block truncate text-sm font-semibold text-slate-800">{item.title}</span><span className="line-clamp-2 text-xs text-slate-500">{item.body}</span></span>
          </label></li>)}
        </ul>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">Đã chọn {checked.size}{max > 1 ? ` / tối đa ${max}` : ""}</span>
          <button type="button" onClick={fill} disabled={checked.size === 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">Điền vào chiến dịch</button>
        </div>
      </>}
      <button type="button" onClick={() => setOpen(false)} className="sr-only"><X /></button>
    </div>}
  </div>;
}
