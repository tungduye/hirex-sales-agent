"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, FileText, LoaderCircle, Plus, Search, Trash2, X, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CreateContentDialog } from "@/modules/content/components/create-content-dialog";
import { ContentTabs } from "@/modules/content/components/content-tabs";
import { copyText, postText } from "@/modules/content/components/copy-text";
import type { ContentTemplate } from "@/modules/content/server/template-row";
import { deleteContentItem } from "@/modules/content/server/content-actions";
import { CONTENT_DEPARTMENTS, CONTENT_FORMATS, CONTENT_LANGUAGES, departmentLabel, formatLabel, languageLabel, styleLabel, type ContentDepartment, type ContentFormat, type ContentLanguage } from "@/modules/content/core/content-options";
import { contentListHref, type ContentListQuery } from "@/modules/content/core/content-list-query";
import type { ContentListItem } from "@/modules/content/server/list-content";
import { categoriesOf, type ContentCategory } from "@/modules/content/core/content-category";
import { batchStatus, isBatchRunning, type BatchTone, type ContentBatchSummary } from "@/modules/content/core/batch-status";

const dateFormatter = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
const formatDate = (value: string) => dateFormatter.format(new Date(value)).replace(",", "");
const percent = (value: number) => `${Math.round(value * 100)}%`;

interface ContentLibraryViewProps {
  items: ContentListItem[];
  templates: ContentTemplate[];
  categories: ContentCategory[];
  batches: ContentBatchSummary[];
  total: number;
  libraryTotal: number;
  query: ContentListQuery;
  loadError: string | null;
  canCreate: boolean;
  canDelete: boolean;
}

export function ContentLibraryView({ items, templates, categories, batches, total, libraryTotal, query, loadError, canCreate, canDelete }: ContentLibraryViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query.q);
  const [isNavigating, startNavigation] = useTransition();
  const lastSubmitted = useRef(query.q);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<ContentListItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = useCallback((next: Partial<Pick<ContentListQuery, "q" | "language" | "format" | "department" | "category" | "page">>) => {
    startNavigation(() => router.replace(contentListHref({ q: query.q, language: query.language, format: query.format, department: query.department, category: query.category, page: 1, ...next }), { scroll: false }));
  }, [router, query.q, query.language, query.format, query.department, query.category]);
  const categoryName = new Map(categories.map((item) => [item.id, item.name]));
  const categoryChoices = query.department === "ALL" ? categories : categoriesOf(categories, query.department, { includeInactive: true });

  useEffect(() => {
    if (query.q !== lastSubmitted.current) { lastSubmitted.current = query.q; setSearch(query.q); }
  }, [query.q]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === lastSubmitted.current) return;
    const timer = setTimeout(() => { lastSubmitted.current = trimmed; go({ q: trimmed, page: 1 }); }, 350);
    return () => clearTimeout(timer);
  }, [search, go]);

  // While a batch of this user is being generated, refresh every 5 seconds to pick up the result.
  const [now, setNow] = useState(() => Date.now());
  const running = batches.some((batch) => isBatchRunning(batch, now));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { setNow(Date.now()); router.refresh(); }, 5_000);
    return () => clearInterval(timer);
  }, [running, router]);

  // The new batch shows up in "Yêu cầu tạo content" with its progress, so no separate notice.
  const handleCreated = useCallback(() => {
    setDialogOpen(false);
    setNotice(null);
    setNow(Date.now());
    router.refresh();
  }, [router]);

  const handleDeleted = useCallback((message: string) => {
    setSelected(null);
    setNotice(message);
    router.refresh();
  }, [router]);

  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const createButton = canCreate ? <Button onClick={() => { setNotice(null); setDialogOpen(true); }}><Plus className="size-4" />Tạo content</Button> : undefined;

  return (
    <>
      <PageHeader title="Kho content" description="Content do AI viết theo brief và mẫu đã chọn. Mỗi content có mã riêng và không trùng quá 50% với content khác trong kho." action={createButton} />
      <ContentTabs active="/content" />
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status">{notice}</div>}
      {batches.length > 0 && <RecentBatches batches={batches} now={now} />}
      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-white p-8 text-center text-sm text-rose-700 shadow-sm">{loadError}</div>
      ) : libraryTotal === 0 ? (
        <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center shadow-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><FileText className="size-7" /></div>
          <h2 className="mt-5 text-xl font-bold">Kho content đang trống</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{canCreate ? "Bấm “Tạo content”, điền thông tin job và chọn ngôn ngữ, định dạng để AI viết." : "Chưa có content nào. Liên hệ người có quyền tạo content."}</p>
          {createButton && <div className="mt-6">{createButton}</div>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" placeholder="Tìm theo mã, tiêu đề, job, nội dung…" /></div>
            <div className="grid grid-cols-2 gap-3 sm:flex">
              <select aria-label="Bộ phận" value={query.department} onChange={(event) => go({ department: event.target.value as ContentDepartment | "ALL", category: "ALL" })} className="h-10 rounded-lg border bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"><option value="ALL">Mọi bộ phận</option>{CONTENT_DEPARTMENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <select aria-label="Ngôn ngữ" value={query.language} onChange={(event) => go({ language: event.target.value as ContentLanguage | "ALL" })} className="h-10 rounded-lg border bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"><option value="ALL">Mọi ngôn ngữ</option>{CONTENT_LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <select aria-label="Định dạng" value={query.format} onChange={(event) => go({ format: event.target.value as ContentFormat | "ALL" })} className="h-10 rounded-lg border bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"><option value="ALL">Mọi định dạng</option>{CONTENT_FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <select aria-label="Phân loại" value={query.category} onChange={(event) => go({ category: event.target.value })} className="h-10 rounded-lg border bg-white px-3 text-sm text-slate-700 focus:border-blue-500 focus:outline-none"><option value="ALL">Mọi phân loại</option>{categoryChoices.map((item) => <option key={item.id} value={item.id}>{query.department === "ALL" ? `${departmentLabel(item.department)} · ` : ""}{item.name}</option>)}</select>
            </div>
            <span className="text-xs font-medium text-slate-500 lg:ml-auto">{isNavigating ? "Đang tải…" : `${total.toLocaleString("vi-VN")} / ${libraryTotal.toLocaleString("vi-VN")} content`}</span>
          </div>
          <div className={`overflow-x-auto transition-opacity ${isNavigating ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[960px] text-left">
              <thead className="whitespace-nowrap bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Mã</th><th className="px-4 py-3 font-semibold">Tiêu đề · Job</th><th className="px-4 py-3 font-semibold">Ngôn ngữ</th><th className="px-4 py-3 font-semibold">Định dạng</th><th className="px-4 py-3 font-semibold">Bộ phận · Phân loại</th><th className="px-4 py-3 text-right font-semibold">Trùng cao nhất</th><th className="px-5 py-3 font-semibold">Người tạo · Ngày</th></tr></thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="cursor-pointer transition-colors hover:bg-slate-50/70" onClick={() => setSelected(item)}>
                    <td className="whitespace-nowrap px-5 py-4"><button type="button" className="font-mono text-sm font-semibold text-blue-700 hover:underline" onClick={(event) => { event.stopPropagation(); setSelected(item); }}>{item.code}</button></td>
                    <td className="max-w-[360px] px-4 py-4"><p className="truncate text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-0.5 truncate text-xs text-slate-500">{item.jobTitle}</p></td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-600">{languageLabel(item.language)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-600">{formatLabel(item.format)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-600">{departmentLabel(item.department)}{item.categoryId && categoryName.get(item.categoryId) ? <span className="mt-0.5 block text-xs text-violet-700">{categoryName.get(item.categoryId)}</span> : null}</td>
                    <td className="px-4 py-4 text-right text-sm tabular-nums text-slate-600">{percent(item.maxSimilarity)}</td>
                    <td className="whitespace-nowrap px-5 py-4"><p className="text-sm text-slate-700">{item.createdByName ?? "—"}</p><p className="mt-0.5 text-xs tabular-nums text-slate-500">{formatDate(item.createdAt)}</p></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total === 0 && <div className="px-5 py-14 text-center text-sm text-slate-500">Không có content khớp bộ lọc.</div>}
          {total > 0 && <div className="flex flex-col gap-3 border-t px-5 py-3 text-sm text-slate-600 sm:flex-row sm:items-center">
            <span className="tabular-nums">Trang {query.page} / {pages}</span>
            <div className="flex items-center gap-2 sm:ml-auto">
              <Button variant="outline" size="sm" disabled={query.page <= 1 || isNavigating} onClick={() => go({ page: query.page - 1 })}><ChevronLeft className="size-4" />Trước</Button>
              <Button variant="outline" size="sm" disabled={query.page >= pages || isNavigating} onClick={() => go({ page: query.page + 1 })}>Sau<ChevronRight className="size-4" /></Button>
            </div>
          </div>}
        </div>
      )}
      {dialogOpen && <CreateContentDialog templates={templates} categories={categories} onClose={() => setDialogOpen(false)} onCreated={handleCreated} />}
      {selected && <ContentDetailDialog item={selected} categoryName={selected.categoryId ? categoryName.get(selected.categoryId) ?? null : null} canDelete={canDelete} onClose={() => setSelected(null)} onDeleted={handleDeleted} />}
    </>
  );
}

const TONE_STYLE: Record<BatchTone, { className: string; icon: typeof CheckCircle2 }> = {
  running: { className: "text-blue-700", icon: LoaderCircle },
  success: { className: "text-emerald-700", icon: CheckCircle2 },
  warning: { className: "text-amber-700", icon: AlertTriangle },
  error: { className: "text-rose-700", icon: XCircle },
};

function RecentBatches({ batches, now }: { batches: ContentBatchSummary[]; now: number }) {
  return (
    <section className="mb-4 rounded-xl border bg-white shadow-sm" aria-live="polite">
      <h2 className="border-b px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">Yêu cầu tạo content của bạn (24 giờ qua)</h2>
      <ul className="divide-y">
        {batches.map((batch) => {
          const status = batchStatus(batch, now);
          const { className, icon: Icon } = TONE_STYLE[status.tone];
          return (
            <li key={batch.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-4">
              <span className="min-w-0 truncate font-semibold text-slate-800 sm:w-56 sm:shrink-0">{batch.jobTitle}</span>
              <span className={`flex min-w-0 flex-1 items-start gap-2 ${className}`}><Icon className={`mt-0.5 size-4 shrink-0 ${status.tone === "running" ? "animate-spin" : ""}`} />{status.text}</span>
              <span className="text-xs tabular-nums text-slate-500">{formatDate(batch.createdAt)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ContentDetailDialog({ item, categoryName, canDelete, onClose, onDeleted }: { item: ContentListItem; categoryName: string | null; canDelete: boolean; onClose: () => void; onDeleted: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  // Copies headline + body so the result can be posted as it is.
  async function copy() {
    setError(null);
    if (await copyText(postText(item.title, item.body))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError("Trình duyệt không cho phép sao chép. Hãy bôi đen và sao chép thủ công.");
    }
  }

  function remove() {
    startDelete(async () => {
      const result = await deleteContentItem(item.id);
      if (result.ok) onDeleted(result.message); else setError(result.message);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="content-detail-title">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Đóng" onClick={onClose} disabled={deleting} />
      <div className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5">
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold text-blue-700">{item.code}</p>
            <h2 id="content-detail-title" className="mt-1 text-lg font-bold tracking-tight">{item.title}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {[item.jobTitle, languageLabel(item.language), formatLabel(item.format), departmentLabel(item.department), categoryName, styleLabel(item.style), item.templateCode ? `Theo mẫu ${item.templateCode}` : null, `Trùng cao nhất ${percent(item.maxSimilarity)}`].filter((tag): tag is string => Boolean(tag)).map((tag) => <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{tag}</span>)}
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={deleting} aria-label="Đóng"><X className="size-5" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5"><div className="whitespace-pre-wrap text-sm leading-7 text-slate-800">{item.body}</div></div>
        {error && <p className="mx-6 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4">
          {canDelete && (confirming
            ? <><span className="mr-auto text-sm text-rose-700">Xóa vĩnh viễn {item.code}?</span><Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>Không</Button><Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={remove} disabled={deleting}>{deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Xóa</Button></>
            : <Button variant="ghost" size="sm" className="mr-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setConfirming(true)}><Trash2 className="size-4" />Xóa</Button>)}
          <Button size="sm" onClick={copy}>{copied ? <><Check className="size-4" />Đã sao chép</> : <><Copy className="size-4" />Sao chép</>}</Button>
        </div>
      </div>
    </div>
  );
}
