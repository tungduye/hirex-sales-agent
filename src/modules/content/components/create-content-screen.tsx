"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, Check, ChevronDown, ChevronLeft, Copy, LoaderCircle, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createContentBatch } from "@/modules/content/server/content-actions";
import { analyzeContentBrief, type BriefSuggestion } from "@/modules/content/server/content-brief-ai";
import { getContentBatchResult, type BatchResult } from "@/modules/content/server/content-batch-result";
import { recordContentCopy } from "@/modules/content/server/content-item-actions";
import { initialCreateContentState } from "@/modules/content/core/content-state";
import { MAX_CONTENT_QUANTITY, OTHER_OPTION } from "@/modules/content/core/content-options";
import { categoriesOf, type ContentCategory } from "@/modules/content/core/content-category";
import { wordCount } from "@/modules/content/core/content-quality";
import type { ContentTemplate } from "@/modules/content/server/template-row";
import { useContentLists } from "@/modules/content/components/content-settings-context";
import { Field, TemplatePicker } from "@/modules/content/components/create-content-dialog";
import { copyText, postText } from "@/modules/content/components/copy-text";

export interface JobChoice { id: string; title: string; location: string; careerTrack: string; companyName: string; companyNamePublic: boolean; salaryRange: string | null; japaneseLevelMin: string | null; sellingPoints: string | null; summary: string | null; requirements: string | null }

const inputClass = "block w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60";
const MEMORY_KEY = "hirex.content.lastChoice";
type Fields = { jobTitle: string; position: string; location: string; languagesRequired: string; salary: string; techSkills: string; highlights: string; jdText: string; blockedTerms: string; styleNote: string; sampleContent: string };
const EMPTY: Fields = { jobTitle: "", position: "", location: "", languagesRequired: "", salary: "", techSkills: "", highlights: "", jdText: "", blockedTerms: "", styleNote: "", sampleContent: "" };
/** Fills empty fields from a Bảng Job job; the client's name goes to the blocked words. */
function jobFields(job: JobChoice, current: Fields): Fields {
  return {
    ...current, jobTitle: job.title,
    position: current.position || job.careerTrack, location: current.location || job.location,
    languagesRequired: current.languagesRequired || (job.japaneseLevelMin ? `Tiếng Nhật ${job.japaneseLevelMin}` : ""),
    salary: current.salary || job.salaryRange || "", highlights: current.highlights || job.sellingPoints || "",
    jdText: current.jdText || [job.summary, job.requirements].filter(Boolean).join("\n"),
    blockedTerms: current.blockedTerms.includes(job.companyName) ? current.blockedTerms : [current.blockedTerms, job.companyName].filter(Boolean).join("; "),
  };
}
const SUGGEST_LABEL: Partial<Record<keyof Fields, string>> = { position: "Vị trí", location: "Địa điểm", languagesRequired: "Ngoại ngữ", salary: "Mức lương", techSkills: "Skill", jobTitle: "Tên job" };

export function CreateContentScreen({ templates, categories, jobs, initialTemplateId = null, initialJobId = null }: { templates: ContentTemplate[]; categories: ContentCategory[]; jobs: JobChoice[]; initialTemplateId?: string | null; initialJobId?: string | null }) {
  const startTemplate = templates.find((template) => template.id === initialTemplateId) ?? null;
  const lists = useContentLists();
  const startJob = jobs.find((job) => job.id === initialJobId) ?? null;
  const [fields, setFields] = useState<Fields>(() => startJob ? jobFields(startJob, EMPTY) : EMPTY);
  // The Bảng Job job this content is for (closed jobs flag their content).
  const [jobId, setJobId] = useState<string | null>(startJob?.id ?? null);
  const set = (name: keyof Fields, value: string) => setFields((current) => ({ ...current, [name]: value }));
  const [format, setFormat] = useState(startTemplate?.format && lists.formats.some((item) => item.value === startTemplate.format) ? startTemplate.format : lists.formats.find((item) => item.value === "POST_LONG")?.value ?? lists.formats[0]?.value ?? "POST_LONG");
  const [language, setLanguage] = useState(lists.languages[0]?.value ?? "VI");
  const [quantity, setQuantity] = useState("3");
  const [department, setDepartment] = useState(startTemplate?.department ?? lists.departments.find((item) => item.value === "REC")?.value ?? lists.departments[0]?.value ?? "REC");
  const [categoryId, setCategoryId] = useState(startTemplate?.categoryId ?? "");
  const [style, setStyle] = useState(lists.styles[0]?.value ?? OTHER_OPTION);
  const [styleOther, setStyleOther] = useState("");
  const [templateIds, setTemplateIds] = useState<string[]>(startTemplate ? [startTemplate.id] : []);
  const [moreOpen, setMoreOpen] = useState(Boolean(startTemplate));
  const [request, setRequest] = useState("");
  const [aiBusy, startAi] = useTransition();
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<BriefSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [pending, startSubmit] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [requested, setRequested] = useState(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // Bộ phận / Phân loại chosen last time (per browser).
  useEffect(() => {
    if (startTemplate) return;
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "null") as { department?: string; categoryId?: string } | null;
        if (saved?.department && lists.departments.some((item) => item.value === saved.department)) {
          setDepartment(saved.department);
          if (saved.categoryId && categories.some((item) => item.id === saved.categoryId && item.department === saved.department && item.active)) setCategoryId(saved.categoryId);
        }
      } catch { /* storage unavailable */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [lists.departments, categories, startTemplate]);
  const remember = (next: { department: string; categoryId: string }) => { try { localStorage.setItem(MEMORY_KEY, JSON.stringify(next)); } catch { /* ignore */ } };

  const formatChoice = lists.formats.find((item) => item.value === format);
  const departmentCategories = categoriesOf(categories, department);
  const departmentTemplates = useMemo(() => templates.filter((template) => template.department === department), [templates, department]);
  const needsLead = !["MEDIA", "NOTICE"].includes(department) && format !== "COMMENT";

  function fillFrom(next: BriefSuggestion, onlyEmpty: boolean) {
    setFields((current) => {
      const copy = { ...current };
      for (const key of ["jobTitle", "position", "location", "languagesRequired", "salary", "techSkills", "highlights"] as const) {
        const value = next[key];
        if (value && (!onlyEmpty || !current[key].trim())) copy[key] = value;
      }
      return copy;
    });
    // Skills / highlights live under "Tuỳ chọn thêm": open it so what AI filled is seen.
    if (next.highlights || next.techSkills) setMoreOpen(true);
    if (!onlyEmpty) {
      if (next.department) { setDepartment(next.department); setCategoryId(""); }
      if (next.contentFormat) setFormat(next.contentFormat);
      if (next.contentLanguage) setLanguage(next.contentLanguage);
      if (next.quantity) setQuantity(String(next.quantity));
    }
  }

  function fromWords() {
    setAiNote(null);
    startAi(async () => {
      const result = await analyzeContentBrief({ text: request, mode: "request" });
      if (!result.ok) { setAiNote(result.message); return; }
      fillFrom(result.suggestion, false);
      setAiNote("AI đã điền các ô theo yêu cầu, anh kiểm tra lại rồi bấm Tạo content.");
    });
  }

  // Pasted JD / old post: after a short pause, AI lists what it found so empty fields can be filled.
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onPaste(value: string) {
    set("jdText", value);
    if (pasteTimer.current) clearTimeout(pasteTimer.current);
    if (value.trim().length < 40) { setSuggestion(null); return; }
    pasteTimer.current = setTimeout(async () => {
      setSuggesting(true);
      const result = await analyzeContentBrief({ text: value, mode: "paste" }).catch(() => null);
      setSuggesting(false);
      setSuggestion(result?.ok ? result.suggestion : null);
    }, 2000);
  }

  function pickJob(title: string) {
    set("jobTitle", title);
    const job = jobs.find((item) => item.title.toLocaleLowerCase("vi") === title.trim().toLocaleLowerCase("vi"));
    setJobId(job?.id ?? null);
    if (job) setFields((current) => jobFields(job, current));
  }

  function submit() {
    setMessage(null); setErrors({});
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    data.set("contentFormat", format); data.set("contentLanguage", language); data.set("quantity", quantity);
    data.set("department", department); data.set("jobId", jobId ?? ""); data.set("categoryId", categoryId); data.set("style", style); data.set("styleOther", styleOther);
    for (const id of templateIds) data.append("templateId", id);
    remember({ department, categoryId });
    startSubmit(async () => {
      const state = await createContentBatch(initialCreateContentState, data);
      if (!state.success || !state.batchId) { setMessage(state.message); setErrors(state.fieldErrors ?? {}); return; }
      setRequested(Number(quantity) || 1);
      setBatchId(state.batchId);
      // On narrow screens the results sit under the form: bring them into view.
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    });
  }

  const error = (name: string) => errors[name]?.[0];
  const found = suggestion ? (Object.keys(SUGGEST_LABEL) as (keyof Fields)[]).filter((key) => suggestion[key as keyof BriefSuggestion] && !fields[key].trim()) : [];
  const missing = suggestion ? (["position", "location", "languagesRequired", "salary"] as const).filter((key) => !suggestion[key] && !fields[key].trim()) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link href="/content" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft className="size-4" />Kho content</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Tạo content</h1></div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-blue-900"><Wand2 className="size-4" />Nhập bằng lời</p>
            <textarea value={request} onChange={(event) => setRequest(event.target.value)} rows={2} maxLength={2000} disabled={aiBusy || pending}
              placeholder="VD: tạo 3 content BrSE lương up to 80M ở HN, ưu tiên ứng viên base Java 3 năm, bảo hiểm full lương"
              className={cn(inputClass, "mt-2 bg-white py-2")} />
            <div className="mt-2 flex items-center gap-3">
              <Button type="button" size="sm" variant="outline" disabled={aiBusy || pending || request.trim().length < 3} onClick={fromWords}>{aiBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}AI điền giúp</Button>
              {aiNote && <span className="text-xs text-slate-600">{aiNote}</span>}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_90px]">
              <Field label="Tên job" required error={error("jobTitle")}>
                <input list="content-jobs" value={fields.jobTitle} onChange={(event) => pickJob(event.target.value)} maxLength={200} required disabled={pending} placeholder="Gõ hoặc chọn từ Bảng Job" className={cn(inputClass, "h-10")} />
                <datalist id="content-jobs">{jobs.map((job) => <option key={job.id} value={job.title}>{job.location}{job.salaryRange ? ` · ${job.salaryRange}` : ""}</option>)}</datalist>
              </Field>
              <Field label="Loại content" required error={error("contentFormat")}>
                <select value={format} onChange={(event) => setFormat(event.target.value)} disabled={pending} className={cn(inputClass, "h-10")}>
                  {lists.formats.map((item) => <option key={item.value} value={item.value}>{item.label}{item.hint ? ` · ${item.hint}` : ""}</option>)}</select>
              </Field>
              <Field label="Ngôn ngữ" required error={error("contentLanguage")}>
                <select value={language} onChange={(event) => setLanguage(event.target.value)} disabled={pending} className={cn(inputClass, "h-10")}>
                  {lists.languages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              </Field>
              <Field label="Số lượng" required error={error("quantity")}>
                <input type="number" min={1} max={MAX_CONTENT_QUANTITY} value={quantity} onChange={(event) => setQuantity(event.target.value)} required disabled={pending} className={cn(inputClass, "h-10")} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Địa điểm" required={needsLead} hint="Tiêu đề luôn bắt đầu bằng [ĐỊA ĐIỂM] VỊ TRÍ" error={error("location")}><input value={fields.location} onChange={(event) => set("location", event.target.value)} maxLength={200} required={needsLead} disabled={pending} placeholder="Hà Nội, HCM, Tokyo…" className={cn(inputClass, "h-10")} /></Field>
              <Field label="Vị trí" required={needsLead} error={error("position")}><input value={fields.position} onChange={(event) => set("position", event.target.value)} maxLength={200} required={needsLead} disabled={pending} placeholder="BrSE, Senior Java…" className={cn(inputClass, "h-10")} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Bộ phận" required error={error("department")}>
                <select value={department} onChange={(event) => { setDepartment(event.target.value); setCategoryId(""); setTemplateIds([]); }} disabled={pending} className={cn(inputClass, "h-10")}>
                  {lists.departments.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              </Field>
              <Field label="Phân loại" error={error("categoryId")}>
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={pending || departmentCategories.length === 0} className={cn(inputClass, "h-10")}>
                  <option value="">Không phân loại</option>{departmentCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Ngoại ngữ" error={error("languagesRequired")}><input value={fields.languagesRequired} onChange={(event) => set("languagesRequired", event.target.value)} maxLength={200} disabled={pending} placeholder="Tiếng Nhật N2…" className={cn(inputClass, "h-10")} /></Field>
              <Field label="Lương" error={error("salary")}><input value={fields.salary} onChange={(event) => set("salary", event.target.value)} maxLength={200} disabled={pending} placeholder="50 – 60M gross…" className={cn(inputClass, "h-10")} /></Field>
            </div>
            <Field label="Dán JD hoặc bài cũ" hint="AI chỉ dùng dữ kiện có ở đây và các ô trên." error={error("jdText")}>
              <textarea value={fields.jdText} onChange={(event) => onPaste(event.target.value)} rows={4} maxLength={8000} disabled={pending} className={cn(inputClass, "py-2")} />
            </Field>
            {(suggesting || found.length > 0 || missing.length > 0) && <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm">
              {suggesting ? <span className="flex items-center gap-2 text-slate-600"><LoaderCircle className="size-4 animate-spin" />AI đang đọc nội dung vừa dán…</span> : <>
                {found.length > 0 && <div className="flex flex-wrap items-center gap-2">
                  {found.map((key) => <button key={key} type="button" onClick={() => set(key, String(suggestion?.[key as keyof BriefSuggestion] ?? ""))}
                    className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-amber-100">{SUGGEST_LABEL[key]}: <b>{String(suggestion?.[key as keyof BriefSuggestion])}</b> — Điền vào</button>)}
                  {found.length > 1 && <button type="button" onClick={() => suggestion && fillFrom(suggestion, true)} className="text-xs font-semibold text-blue-700 hover:underline">Điền tất cả</button>}
                </div>}
                {missing.length > 0 && <p className="mt-2 text-xs text-amber-800">Chưa thấy {missing.map((key) => SUGGEST_LABEL[key]?.toLocaleLowerCase("vi")).join(", ")} — bài sẽ yếu hơn nếu thiếu (không bắt buộc).</p>}
              </>}
            </div>}

            <div className="rounded-lg border">
              <button type="button" onClick={() => setMoreOpen((open) => !open)} className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-700">Tuỳ chọn thêm<ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} /></button>
              {moreOpen && <div className="space-y-4 border-t p-3">
                <Field label="Skill tech" error={error("techSkills")}><input value={fields.techSkills} onChange={(event) => set("techSkills", event.target.value)} maxLength={1000} disabled={pending} placeholder="Java, Spring Boot, AWS…" className={cn(inputClass, "h-10")} /></Field>
                <Field label="Điểm nổi bật" error={error("highlights")}><textarea value={fields.highlights} onChange={(event) => set("highlights", event.target.value)} rows={2} maxLength={2000} disabled={pending} placeholder="Bảo hiểm full lương, process 1 vòng…" className={cn(inputClass, "py-2")} /></Field>
                <Field label="Từ khóa cấm" hint="Tên khách hàng, website… cách nhau bằng ; hoặc ," error={error("blockedTerms")}><input value={fields.blockedTerms} onChange={(event) => set("blockedTerms", event.target.value)} maxLength={1000} disabled={pending} className={cn(inputClass, "h-10")} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Phong cách" error={error("style")}>
                    <select value={style} onChange={(event) => setStyle(event.target.value)} disabled={pending} className={cn(inputClass, "h-10")}>{lists.styles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}<option value={OTHER_OPTION}>Khác…</option></select>
                    {style === OTHER_OPTION && <input value={styleOther} onChange={(event) => setStyleOther(event.target.value)} maxLength={100} required disabled={pending} placeholder="Nhập phong cách" className={cn(inputClass, "mt-2 h-10")} />}
                  </Field>
                  <Field label="Ghi chú phong cách" error={error("styleNote")}><input value={fields.styleNote} onChange={(event) => set("styleNote", event.target.value)} maxLength={500} disabled={pending} placeholder="Xưng em, gọi anh em; emoji vừa phải" className={cn(inputClass, "h-10")} /></Field>
                </div>
                <div><p className="mb-2 text-sm font-semibold text-slate-700">Mẫu content</p><TemplatePicker templates={departmentTemplates} selected={templateIds} onChange={setTemplateIds} disabled={pending} />{error("templateIds") && <p className="mt-1 text-xs text-rose-600">{error("templateIds")}</p>}</div>
                <Field label="Content mẫu tự dán" hint="AI viết theo bố cục và giọng của bài này, dữ kiện lấy từ brief." error={error("sampleContent")}><textarea value={fields.sampleContent} onChange={(event) => set("sampleContent", event.target.value)} rows={3} maxLength={6000} disabled={pending} className={cn(inputClass, "py-2")} /></Field>
              </div>}
            </div>

            {message && <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{message}</div>}
            <div className="flex items-center justify-end gap-3 border-t pt-4">
              {formatChoice?.hint && <span className="mr-auto text-xs text-slate-500">{formatChoice.label}: {formatChoice.hint} mỗi ngôn ngữ</span>}
              <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Tạo content</Button>
            </div>
          </section>
        </form>
        <div ref={resultsRef} className="scroll-mt-4"><Results key={batchId ?? "none"} batchId={batchId} requested={requested} /></div>
      </div>
    </div>
  );
}

const ERROR_TEXT: Record<string, string> = { ALL_TOO_SIMILAR: "Các bản AI viết đều trùng quá 50% với content đã có. Thử đổi điểm nhấn hoặc mẫu.", DRAFTS_REJECTED: "Các bản AI viết đều vi phạm quy tắc (từ khóa cấm, độ dài…). Thử lại hoặc bỏ bớt mẫu.", AI_UNAVAILABLE: "AI đang bận, thử lại sau ít phút." };

function Results({ batchId, requested }: { batchId: string | null; requested: number }) {
  const [result, setResult] = useState<BatchResult | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!batchId) return;
    let live = true; const started = Date.now();
    const tick = async () => {
      const next = await getContentBatchResult(batchId).catch(() => null);
      if (!live) return;
      if (next) setResult(next);
      if (next && next.status !== "PENDING") return;
      if (Date.now() - started > 6 * 60_000) { setTimedOut(true); return; }
      setTimeout(tick, 3000);
    };
    tick();
    return () => { live = false; };
  }, [batchId]);

  if (!batchId) return <aside className="rounded-xl border border-dashed bg-white p-8 text-center text-sm text-slate-500 xl:sticky xl:top-4">Content tạo xong hiện ở đây, mỗi bài có nút Sao chép. Bài cũng được lưu vào Kho content.</aside>;
  const pending = !result || result.status === "PENDING";
  return (
    <aside className="space-y-3 xl:sticky xl:top-4" aria-live="polite">
      <div className={cn("rounded-xl border px-4 py-3 text-sm", pending ? "border-blue-200 bg-blue-50 text-blue-800" : result.items.length ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700")}>
        {pending ? (timedOut ? "Vẫn đang viết, kết quả sẽ có trong Kho content." : <span className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />AI đang viết {requested} bài (viết dư rồi giữ bản tốt nhất), khoảng 1–2 phút…</span>)
          : result.items.length ? `Xong ${result.items.length}/${result.quantity} bài${result.rejectedCount ? `; ${result.rejectedCount} bài bị loại vì trùng hoặc sai quy tắc` : ""}.`
            : ERROR_TEXT[result.errorCode ?? ""] ?? "Chưa tạo được content, thử lại sau."}
      </div>
      {pending && Array.from({ length: requested }, (_, index) => <div key={index} className="h-40 animate-pulse rounded-xl border bg-white" />)}
      {result?.items.map((item) => <ResultCard key={item.id} item={item} />)}
    </aside>
  );
}

function ResultCard({ item }: { item: BatchResult["items"][number] }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  async function copy() { if (await copyText(postText(item.title, item.body))) { setCopied(true); setTimeout(() => setCopied(false), 2000); void recordContentCopy(item.id); } }
  return (
    <article className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-mono text-[11px] text-slate-500">{item.code} · {wordCount(item.body)} chữ</p>
          <h3 className="mt-1 font-bold uppercase leading-6 text-blue-700">{item.title}</h3></div>
        <Button size="sm" onClick={copy}>{copied ? <><Check className="size-4" />Đã sao chép</> : <><Copy className="size-4" />Sao chép</>}</Button>
      </div>
      <p className={cn("mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700", !open && "line-clamp-6")}>{item.body}</p>
      <button type="button" onClick={() => setOpen((value) => !value)} className="mt-1 text-xs font-semibold text-blue-700 hover:underline">{open ? "Thu gọn" : "Xem đủ"}</button>
    </article>
  );
}
