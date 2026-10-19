"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, FileText, LoaderCircle, Pencil, Plus, Search, Trash2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContentTabs } from "@/modules/content/components/content-tabs";
import { copyText, postText } from "@/modules/content/components/copy-text";
import { deleteContentItem } from "@/modules/content/server/content-actions";
import { useContentLists } from "@/modules/content/components/content-settings-context";
import { contentListHref, type ContentListQuery } from "@/modules/content/core/content-list-query";
import type { ContentListItem } from "@/modules/content/server/list-content";
import type { ContentCategory } from "@/modules/content/core/content-category";
import { buildContentTree, NO_CATEGORY, type TreeFilter } from "@/modules/content/core/content-tree";
import { ContentFolderTree, ITEM_DRAG_TYPE, MoveToFolder } from "@/modules/content/components/content-folder-tree";
import { editContentItem } from "@/modules/content/server/content-quick-actions";
import { wordCount } from "@/modules/content/core/content-quality";
import { batchStatus, isBatchRunning, type BatchTone, type ContentBatchSummary } from "@/modules/content/core/batch-status";

const dateFormatter = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
const formatDate = (value: string) => dateFormatter.format(new Date(value)).replace(",", "");
const percent = (value: number) => `${Math.round(value * 100)}%`;

interface ContentLibraryViewProps {
  items: ContentListItem[];
  categories: ContentCategory[];
  batches: ContentBatchSummary[];
  total: number;
  libraryTotal: number;
  treeEntries: Array<{ department: string; categoryId: string | null; format: string | null }>;
  query: ContentListQuery;
  loadError: string | null;
  canCreate: boolean;
  canDelete: boolean;
  /** Can rename / add / reorder folders and move content between them. */
  canManage: boolean;
}

/** "Content đã tạo" laid out like Tài liệu: folder tree, list + reader, actions above the text. */
export function ContentLibraryView({ items, categories, batches, total, libraryTotal, treeEntries, query, loadError, canCreate, canDelete, canManage }: ContentLibraryViewProps) {
  const router = useRouter();
  const lists = useContentLists();
  const { allLanguages, departmentLabel, formatLabel, languageLabel } = lists;
  const [search, setSearch] = useState(query.q);
  const [isNavigating, startNavigation] = useTransition();
  const lastSubmitted = useRef(query.q);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const current: TreeFilter = { department: query.department === "ALL" ? undefined : query.department, category: query.category === "ALL" ? undefined : query.category, format: query.format === "ALL" ? undefined : query.format };
  const categoryName = useMemo(() => new Map(categories.map((item) => [item.id, item.name])), [categories]);
  const tree = useMemo(() => buildContentTree(treeEntries, { departments: lists.settings.departments, formats: lists.settings.formats, categories }), [treeEntries, lists.settings, categories]);

  const go = useCallback((next: Partial<Pick<ContentListQuery, "q" | "language" | "format" | "department" | "category" | "page">>) => {
    setSelectedId(null);
    startNavigation(() => router.replace(contentListHref({ q: query.q, language: query.language, format: query.format, department: query.department, category: query.category, page: 1, ...next }), { scroll: false }));
  }, [router, query.q, query.language, query.format, query.department, query.category]);
  const choose = (filter: TreeFilter) => {
    go({ department: filter.department ?? "ALL", category: filter.category ?? "ALL", format: filter.format ?? "ALL" });
  };

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

  const handleDeleted = useCallback((message: string) => { setSelectedId(null); setNotice(message); router.refresh(); }, [router]);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const folderName = current.format ? formatLabel(current.format) : current.category ? (current.category === NO_CATEGORY ? "Chưa phân loại" : categoryName.get(current.category) ?? "") : current.department ? departmentLabel(current.department) : "Tất cả content";
  const createButton = canCreate ? <Button asChild><Link href="/content/new"><Plus className="size-4" />Tạo content</Link></Button> : undefined;
  return (
    <>
      <PageHeader title="Kho content" description="Content do AI viết theo brief và mẫu đã chọn. Mỗi content có mã riêng và không trùng quá 50% với content khác trong kho." action={createButton} />
      <ContentTabs active="/content" />
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status">{notice}</div>}
      {batches.length > 0 && <RecentBatches batches={batches} now={now} />}
      {loadError ? <div className="rounded-xl border border-rose-200 bg-white p-8 text-center text-sm text-rose-700 shadow-sm">{loadError}</div>
        : libraryTotal === 0 ? (
          <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center shadow-sm">
            <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><FileText className="size-7" /></div>
            <h2 className="mt-5 text-xl font-bold">Kho content đang trống</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{canCreate ? "Bấm “Tạo content”, điền thông tin job để AI viết." : "Chưa có content nào. Liên hệ người có quyền tạo content."}</p>
            {createButton && <div className="mt-6">{createButton}</div>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50/50 p-3">
              <div className="flex min-w-60 flex-1 items-center gap-2 rounded-xl border bg-white px-3 focus-within:border-indigo-400"><Search className="size-4 shrink-0 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Tìm content" placeholder="Tìm theo mã, tiêu đề, job, nội dung…" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" /></div>
              <select aria-label="Ngôn ngữ" value={query.language} onChange={(event) => go({ language: event.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"><option value="ALL">Mọi ngôn ngữ</option>{allLanguages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
              <span className="text-xs text-slate-500">{isNavigating ? "Đang tải…" : `${total.toLocaleString("vi-VN")} / ${libraryTotal.toLocaleString("vi-VN")} content`}</span>
            </div>
            <div className="grid lg:grid-cols-[260px_minmax(0,1fr)]">
              <ContentFolderTree tree={tree} total={treeEntries.length} unit="content" active={current} onChoose={choose} canManage={canManage} itemKind="content" onChanged={(message) => { setNotice(message); router.refresh(); }} />
              <div className={cn("min-w-0 transition-opacity", isNavigating && "opacity-60")}>
                <div className="border-b px-4 py-2.5 text-xs text-slate-500"><span className="font-semibold text-slate-700">{folderName}</span> · {total} content</div>
                <ul className="max-h-72 divide-y overflow-y-auto border-b">
                  {items.map((item) => <li key={item.id} draggable={canManage} onDragStart={(event) => { event.dataTransfer.setData(ITEM_DRAG_TYPE, item.id); event.dataTransfer.effectAllowed = "move"; }} title={canManage ? "Kéo thả vào thư mục bên trái để chuyển" : undefined}><button type="button" onClick={() => setSelectedId(item.id)} className={cn("block w-full px-4 py-2.5 text-left", selected?.id === item.id ? "bg-indigo-50" : "hover:bg-slate-50")}>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs"><span className="font-mono font-semibold text-slate-500">{item.code}</span><span className="text-slate-500">{languageLabel(item.language)}</span>
                      {item.used && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">Đã dùng</span>}<span className="ml-auto text-slate-400">{formatDate(item.createdAt)}</span></span>
                    <span className="mt-0.5 block truncate text-sm font-bold uppercase text-blue-700">{item.title}</span>
                  </button></li>)}
                  {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">Không có content khớp bộ lọc.</li>}
                </ul>
                {total > query.pageSize && <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-slate-600">
                  <span className="tabular-nums">Trang {query.page} / {pages}</span>
                  <span className="ml-auto flex gap-2"><Button variant="outline" size="sm" disabled={query.page <= 1 || isNavigating} onClick={() => go({ page: query.page - 1 })}><ChevronLeft className="size-4" />Trước</Button>
                    <Button variant="outline" size="sm" disabled={query.page >= pages || isNavigating} onClick={() => go({ page: query.page + 1 })}>Sau<ChevronRight className="size-4" /></Button></span>
                </div>}
                {selected ? <ContentReader key={selected.id} item={selected} categoryName={selected.categoryId ? categoryName.get(selected.categoryId) ?? null : null} canDelete={canDelete} onDeleted={handleDeleted}
                  onSaved={(message) => { setNotice(message); router.refresh(); }} moveControl={canManage ? <MoveToFolder tree={tree} itemKind="content" itemId={selected.id} onChanged={(message) => { setNotice(message); router.refresh(); }} /> : null} />
                  : <p className="py-16 text-center text-sm text-slate-400">Chọn một content để đọc.</p>}
              </div>
            </div>
          </div>
        )}
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

function ContentReader({ item, categoryName, canDelete, onDeleted, onSaved, moveControl }: { item: ContentListItem; categoryName: string | null; canDelete: boolean; onDeleted: (message: string) => void; onSaved: (message: string) => void; moveControl?: ReactNode }) {
  const { departmentLabel, formatLabel, languageLabel, styleLabel } = useContentLists();
  const [copied, setCopied] = useState<"all" | "body" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  function save() {
    setError(null);
    startDelete(async () => { const result = await editContentItem({ id: item.id, title, body }); if (result.ok) { setEditing(false); onSaved(result.message); } else setError(result.message); });
  }
  async function copy(kind: "all" | "body") {
    setError(null);
    if (await copyText(kind === "all" ? postText(item.title, item.body) : item.body)) { setCopied(kind); setTimeout(() => setCopied(null), 2000); }
    else setError("Trình duyệt không cho phép sao chép. Hãy bôi đen và sao chép thủ công.");
  }
  function remove() {
    startDelete(async () => { const result = await deleteContentItem(item.id); if (result.ok) onDeleted(result.message); else setError(result.message); });
  }
  const tags = [item.jobTitle, departmentLabel(item.department), categoryName, formatLabel(item.format), languageLabel(item.language), styleLabel(item.style), `${wordCount(item.body)} chữ`].filter((tag): tag is string => Boolean(tag));
  const info = [item.templateCode ? `Theo mẫu ${item.templateCode}` : null, `Trùng cao nhất ${percent(item.maxSimilarity)}`, `${item.createdByName ?? "—"} · ${formatDate(item.createdAt)}`, item.used ? "Đã gắn với một chiến dịch" : null].filter((value): value is string => Boolean(value));
  return (
    <article className="p-5">
      <p className="font-mono text-xs font-semibold text-indigo-600">{item.code}</p>
      {editing
        ? <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} aria-label="Tiêu đề" className="mt-1 w-full rounded-lg border border-indigo-300 px-3 py-2 text-base font-bold uppercase text-blue-700 focus:outline-none" />
        : <h2 className="mt-1 text-lg font-bold uppercase leading-7 text-blue-700" onDoubleClick={() => setEditing(true)} title="Bấm đúp để sửa">{item.title}</h2>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => copy("all")}>{copied === "all" ? <><Check className="size-4" />Đã sao chép</> : <><Copy className="size-4" />Sao chép</>}</Button>
        <Button size="sm" variant="outline" onClick={() => copy("body")}>{copied === "body" ? <><Check className="size-4" />Đã sao chép</> : "Chỉ nội dung"}</Button>
        {editing
          ? <><Button size="sm" onClick={save} disabled={deleting}>{deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}Lưu</Button><Button size="sm" variant="outline" onClick={() => { setEditing(false); setTitle(item.title); setBody(item.body); }} disabled={deleting}>Huỷ</Button></>
          : <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" />Sửa</Button>}
        {moveControl}
        {canDelete && (confirming
          ? <span className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2 text-xs text-rose-700">Xóa vĩnh viễn {item.code}?<Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={deleting}>Không</Button><Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={remove} disabled={deleting}>{deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}Xóa</Button></span>
          : <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setConfirming(true)}><Trash2 className="size-4" />Xóa</Button>)}
      </div>
      {error && <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">{tags.map((tag) => <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{tag}</span>)}</div>
      {editing
        ? <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={14} maxLength={20000} aria-label="Nội dung" className="mt-4 w-full rounded-lg border border-indigo-300 p-3 text-sm leading-7 focus:outline-none" />
        : <div className="mt-4 max-h-[55vh] overflow-auto whitespace-pre-wrap text-sm leading-7 text-slate-800" onDoubleClick={() => setEditing(true)} title="Bấm đúp để sửa">{item.body}</div>}
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-slate-500">{info.map((line) => <li key={line}>{line}</li>)}</ul>
    </article>
  );
}
