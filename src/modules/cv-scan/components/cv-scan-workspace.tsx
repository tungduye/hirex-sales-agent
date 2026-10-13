"use client";

import { Check, Clipboard, Download, FileScan, FileText, LoaderCircle, Pencil, Plus, Printer, Sparkles, Trash2, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { CvScanResult } from "../types";
import { readCvSession, writeCvSession } from "../session";

const ACCEPT = ".pdf,.doc,.docx,.xlsx,.csv,.txt";
const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 45 * 1024 * 1024;

export function CvScanWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CvScanResult | null>(null);
  const [activeTab, setActiveTab] = useState<"pr" | "translated">("pr");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restored, setRestored] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = readCvSession(window.sessionStorage);
        if (saved) { setResult(saved.result); setActiveTab(saved.activeTab); }
      } catch { setStorageWarning("Trình duyệt không cho đọc phiên đã lưu. Kết quả mới vẫn có thể được tải xuống."); }
      finally { setRestored(true); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!restored) return;
    try {
      writeCvSession(window.sessionStorage, result ? { result, activeTab } : null);
    } catch {
      // Do not leave an older candidate cached if saving the current one fails.
      try { writeCvSession(window.sessionStorage, null); } catch {}
      window.setTimeout(() => setStorageWarning("Không thể lưu phiên trong trình duyệt. Hãy tải kết quả xuống trước khi tải lại trang."), 0);
    }
  }, [result, activeTab, restored]);
  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    const interval = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [running]);

  function addFiles(incoming: File[]) {
    setError(null);
    const allowed = new Set(["pdf", "doc", "docx", "xlsx", "csv", "txt"]);
    const merged = [...files];
    for (const file of incoming) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!allowed.has(ext)) { setError(`Không hỗ trợ tệp ${file.name}.`); continue; }
      if (file.size > 15 * 1024 * 1024) { setError(`${file.name} vượt quá 15 MB.`); continue; }
      if (!merged.some((item) => item.name === file.name && item.size === file.size)) merged.push(file);
    }
    if (merged.length > MAX_FILES) return setError("Mỗi lượt chỉ xử lý tối đa 10 tệp.");
    if (merged.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) return setError("Tổng dung lượng tệp vượt quá 45 MB.");
    setFiles(merged);
  }

  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }
  async function scan() {
    if (!files.length || running || !restored) return;
    setElapsedSeconds(0); setRunning(true); setError(null); setResult(null);
    const form = new FormData(); for (const file of files) form.append("files", file);
    try {
      const response = await fetch("/api/cv-scan", { method: "POST", body: form });
      const payload = await response.json() as CvScanResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "SCAN_FAILED");
      setResult(payload); setActiveTab("pr"); setEditing(false);
    } catch (cause) { setError(errorMessage(cause instanceof Error ? cause.message : "SCAN_FAILED")); }
    finally { setRunning(false); }
  }

  function clearSession() { setFiles([]); setResult(null); setError(null); setCopied(false); setEditing(false); if (inputRef.current) inputRef.current.value = ""; }
  function updateResult(patch: Partial<CvScanResult>) { setResult((current) => current ? { ...current, ...patch } : current); }
  async function copyPr() { if (!result) return; await navigator.clipboard.writeText(prPlainText(result)); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  function downloadWord() {
    if (!result) return;
    const html = documentHtml(result);
    downloadBlob(new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }), `${safeFilename(result.candidateName || "ung-vien")}-PR-va-CV-dich.doc`);
  }
  function printPdf() {
    if (!result) return;
    const popup = window.open("", "_blank");
    if (!popup) return setError("Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi thử lại.");
    popup.opener = null;
    popup.document.open(); popup.document.write(documentHtml(result)); popup.document.close(); popup.focus(); window.setTimeout(() => popup.print(), 300);
  }

  return <div className="space-y-5">
    <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Công cụ tuyển dụng</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">AI Scan CV</h1><p className="mt-1 text-sm text-slate-500">Gom nhiều tệp của một ứng viên, tạo PR và bản dịch trong một phiên tạm thời.</p></div><span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><Check className="size-3.5"/>Không lưu vào database</span></header>
    <div className="grid min-h-[680px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/50 xl:grid-cols-[390px_minmax(0,1fr)]">
      <section className="border-b border-slate-200 p-5 xl:border-b-0 xl:border-r">
        <div className="flex items-center gap-2"><span className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><UploadCloud className="size-5"/></span><div><h2 className="font-bold text-slate-900">Thêm CV ứng viên</h2><p className="text-xs text-slate-500">Các tệp trong một lượt phải thuộc cùng một người.</p></div></div>
        <div onDragEnter={(event)=>{event.preventDefault();if(!running)setDragging(true)}} onDragOver={(event)=>event.preventDefault()} onDragLeave={()=>setDragging(false)} onDrop={(event)=>{event.preventDefault();if(!running)drop(event)}} onClick={()=>{if(!running)inputRef.current?.click()}} className={`mt-5 flex min-h-52 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 text-center transition ${running ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60" : dragging ? "cursor-pointer border-blue-500 bg-blue-50" : "cursor-pointer border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50"}`}>
          <span className="flex size-14 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm"><Plus className="size-7"/></span><p className="mt-4 text-sm font-bold text-slate-800">Kéo CV vào đây hoặc bấm để chọn</p><p className="mt-1 text-xs leading-5 text-slate-500">PDF, DOC, DOCX, XLSX, CSV, TXT<br/>Tối đa 10 tệp · tổng 45 MB</p>
          <input ref={inputRef} type="file" multiple accept={ACCEPT} disabled={running} className="hidden" onChange={(event)=>addFiles(Array.from(event.target.files ?? []))}/>
        </div>
        {files.length ? <div className="mt-4 space-y-2"><div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-600">{files.length} tệp đã chọn</span><span className="text-slate-400">{formatBytes(totalBytes)}</span></div>{files.map((file,index)=><div key={`${file.name}:${file.size}`} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600"><FileText className="size-4"/></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-700">{file.name}</p><p className="text-[10px] text-slate-400">{formatBytes(file.size)}</p></div><button type="button" disabled={running} onClick={(event)=>{event.stopPropagation();setFiles((current)=>current.filter((_,itemIndex)=>itemIndex!==index))}} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40" aria-label={`Bỏ ${file.name}`}><X className="size-4"/></button></div>)}</div> : null}
        {storageWarning ? <p role="status" className="mt-4 text-xs text-amber-700">{storageWarning}</p> : null}
        {result && !files.length ? <p className="mt-4 text-xs text-blue-700">Đã giữ lại kết quả phiên trước. Chọn lại file CV nếu muốn chạy lượt mới.</p> : null}
        {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">{error}</p> : null}
        <button type="button" disabled={!restored||!files.length||running} onClick={()=>void scan()} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{running?<><LoaderCircle className="size-5 animate-spin"/>Đang đọc và dịch CV…</>:<><Sparkles className="size-5"/>Chạy Scan CV</>}</button>
        <button type="button" onClick={clearSession} disabled={!restored||running||(!files.length&&!result)} className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40"><Trash2 className="size-4"/>Xóa phiên hiện tại</button>
        <div className="mt-5 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">Bản PR, CV dịch và chỉnh sửa được giữ khi tải lại trang trong cùng tab; chỉ thay khi chạy lượt mới hoặc xóa phiên. Không lưu vào database. File CV gốc không được lưu: hãy chọn lại file nếu muốn scan lại. Tải kết quả xuống trước khi đóng tab.</div>
      </section>
      <section className="min-w-0 bg-slate-50/70">
        {!result && !running ? <EmptyResult/> : running ? <ScanningState files={files} elapsedSeconds={elapsedSeconds}/> : result ? <div className="flex h-full min-h-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-5 py-4"><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Đã xử lý xong</p><h2 className="break-words text-lg font-bold text-slate-900">{result.candidateName || "Ứng viên chưa xác định"}</h2></div><div className="flex flex-wrap gap-2"><button onClick={()=>setEditing((value)=>!value)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${editing?"border-blue-200 bg-blue-50 text-blue-700":"bg-white text-slate-600 hover:border-blue-300"}`}>{editing?<Check className="size-3.5"/>:<Pencil className="size-3.5"/>}{editing?"Xong":"Chỉnh sửa"}</button><button onClick={()=>void copyPr()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-white px-3 text-xs font-semibold text-slate-600 hover:border-blue-300">{copied?<Check className="size-3.5 text-emerald-600"/>:<Clipboard className="size-3.5"/>}{copied?"Đã sao chép":"Copy PR"}</button><button onClick={downloadWord} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-white px-3 text-xs font-semibold text-slate-600 hover:border-blue-300"><Download className="size-3.5"/>Tải Word</button><button onClick={printPdf} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700"><Printer className="size-3.5"/>In / Lưu PDF</button></div></div>
          <div className="flex border-b bg-white px-5"><button onClick={()=>setActiveTab("pr")} className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeTab==="pr"?"border-blue-600 text-blue-600":"border-transparent text-slate-500"}`}>Bản PR</button><button onClick={()=>setActiveTab("translated")} className={`border-b-2 px-4 py-3 text-sm font-semibold ${activeTab==="translated"?"border-blue-600 text-blue-600":"border-transparent text-slate-500"}`}>CV dịch tiếng Việt</button></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">{activeTab==="pr"?(editing?<PrEditor result={result} onChange={updateResult}/>:<PrPreview result={result}/>):(editing?<TranslatedEditor value={result.translatedCvMarkdown} onChange={(value)=>updateResult({translatedCvMarkdown:value})}/>:<TranslatedPreview value={result.translatedCvMarkdown}/>)}</div>
        </div> : null}
      </section>
    </div>
  </div>;
}

function EmptyResult(){return <div className="flex h-full min-h-[620px] flex-col items-center justify-center p-8 text-center"><span className="flex size-20 items-center justify-center rounded-3xl bg-white text-blue-500 shadow-sm"><FileScan className="size-9"/></span><h2 className="mt-5 text-lg font-bold text-slate-800">Bản PR và CV dịch sẽ hiển thị ở đây</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-500">Thêm toàn bộ CV của một ứng viên rồi bấm Chạy Scan CV. Anh có thể sửa nội dung trực tiếp trước khi sao chép hoặc tải xuống.</p></div>}
function ScanningState({files,elapsedSeconds}:{files:File[];elapsedSeconds:number}){
  const percent = Math.min(95, Math.floor(95 * (1 - Math.exp(-elapsedSeconds / 65))));
  const phase = elapsedSeconds < 8 ? "Đang tải và chuẩn bị CV" : elapsedSeconds < 45 ? "AI đang đọc và hợp nhất nội dung" : "Đang tạo PR và bản dịch tiếng Việt";
  return <div className="flex h-full min-h-[620px] items-center justify-center p-5 sm:p-8" role="status" aria-live="polite">
    <div className="w-full max-w-xl rounded-3xl border border-blue-100 bg-white p-6 text-center shadow-xl shadow-blue-100/60 sm:p-10">
      <div className="relative mx-auto flex size-28 items-center justify-center rounded-full bg-blue-50" style={{background:`conic-gradient(#2563eb ${percent}%, #eff6ff ${percent}%)`}}><div className="flex size-24 flex-col items-center justify-center rounded-full bg-white"><span className="text-3xl font-bold tabular-nums text-blue-700">{percent}%</span><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">ước tính</span></div></div>
      <h2 className="mt-6 text-xl font-bold text-slate-900">Đang scan {files.length} tệp CV</h2>
      <p className="mt-2 text-sm font-medium text-blue-700">{phase}</p>
      <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-label="Tiến độ scan CV ước tính" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-[width] duration-700" style={{width:`${percent}%`}}/></div>
      <div className="mt-3 flex justify-between gap-3 text-xs text-slate-500"><span>Đã chờ {Math.floor(elapsedSeconds/60)}:{String(elapsedSeconds%60).padStart(2,"0")}</span><span>Hoàn tất khi AI trả kết quả</span></div>
      <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">Phần trăm là ước tính trong lúc xử lý, tối đa 95% trước khi có kết quả. Quá trình có thể mất vài phút; vui lòng giữ trang mở.</p>
    </div>
  </div>;
}

function PrEditor({result,onChange}:{result:CvScanResult;onChange:(patch:Partial<CvScanResult>)=>void}){
  return <div className="mx-auto max-w-4xl rounded-2xl border bg-white p-6 shadow-sm sm:p-9"><textarea value={result.prTitle} onChange={(e)=>onChange({prTitle:e.target.value})} rows={2} className="w-full resize-none rounded-lg border border-blue-200 bg-blue-50/30 px-3 py-2 text-xl font-bold leading-8 text-slate-950 outline-none focus:border-blue-400"/><EditableSection title="I. Lịch sử kinh nghiệm và Skill" values={result.experienceAndSkills} phrases={result.importantPhrases} onChange={(values)=>onChange({experienceAndSkills:values})}/><EditableSection title="II. Học vấn và chứng chỉ" values={result.educationAndCertificates} phrases={result.importantPhrases} onChange={(values)=>onChange({educationAndCertificates:values})}/><EditableSection title="III. Ghi chú thêm" values={result.additionalNotes} phrases={result.importantPhrases} onChange={(values)=>onChange({additionalNotes:values})}/><div className="mt-7 border-t pt-4 text-xs text-slate-500"><b>File CV đã đọc:</b> {result.sourceFiles.join(", ")}</div></div>
}
function EditableSection({title,values,onChange}:{title:string;values:string[];phrases:string[];onChange:(values:string[])=>void}){
  return <section className="mt-7"><h3 className="text-sm font-bold text-slate-900">{title}</h3><div className="mt-3 space-y-2">{values.map((value,index)=><div key={index} className="group flex gap-2"><span className="pt-2 text-sm font-bold text-slate-700">+</span><div className="min-w-0 flex-1"><div className="pointer-events-none mb-1 text-xs text-slate-400 opacity-0 transition group-hover:opacity-100">Có thể chỉnh sửa</div><textarea value={value} onChange={(e)=>onChange(values.map((item,itemIndex)=>itemIndex===index?e.target.value:item))} rows={Math.max(2,Math.ceil(value.length/105))} className="w-full resize-y rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm leading-6 text-slate-700 outline-none hover:border-slate-200 focus:border-blue-300 focus:bg-blue-50/30" aria-label={`${title} ${index+1}`}/></div></div>)}</div></section>
}
function TranslatedEditor({value,onChange}:{value:string;onChange:(value:string)=>void}){return <div className="mx-auto max-w-4xl rounded-2xl border bg-white p-6 shadow-sm sm:p-9"><div className="mb-5 flex items-center gap-2"><FileText className="size-5 text-blue-600"/><h3 className="font-bold text-slate-900">Bản CV dịch tiếng Việt</h3></div><textarea value={value} onChange={(e)=>onChange(e.target.value)} rows={32} className="w-full resize-y border-0 bg-transparent text-sm leading-7 text-slate-700 outline-none"/></div>}

function PrPreview({result}:{result:CvScanResult}){
  return <article className="mx-auto max-w-4xl rounded-2xl border bg-white p-6 shadow-sm sm:p-10"><h1 className="break-words text-2xl font-bold leading-9 text-slate-950">{result.prTitle}</h1><PreviewSection title="I. Lịch sử kinh nghiệm và Skill" values={result.experienceAndSkills} phrases={result.importantPhrases}/><PreviewSection title="II. Học vấn và chứng chỉ" values={result.educationAndCertificates} phrases={result.importantPhrases}/><PreviewSection title="III. Ghi chú thêm" values={result.additionalNotes} phrases={result.importantPhrases}/><div className="mt-8 border-t pt-4 text-xs leading-5 text-slate-500"><b>File CV đã đọc:</b> {result.sourceFiles.join(", ")}</div></article>
}
function PreviewSection({title,values,phrases}:{title:string;values:string[];phrases:string[]}){
  return <section className="mt-8"><h2 className="text-sm font-bold text-slate-950">{title}</h2><div className="mt-4 space-y-3">{values.map((value,index)=><div key={index} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2 text-sm leading-7 text-slate-700"><span className="font-bold text-blue-600">+</span><p className="break-words"><HighlightedText value={value} phrases={phrases}/></p></div>)}</div></section>
}
function HighlightedText({value,phrases}:{value:string;phrases:string[]}){
  const matches=[...phrases].filter((phrase)=>phrase&&value.includes(phrase)).sort((a,b)=>value.indexOf(a)-value.indexOf(b));
  if(!matches.length)return value;
  const parts:ReactNode[]=[];let cursor=0;
  for(const phrase of matches){const index=value.indexOf(phrase,cursor);if(index<cursor)continue;if(index>cursor)parts.push(value.slice(cursor,index));parts.push(<strong key={`${index}:${phrase}`} className="font-bold text-red-600">{phrase}</strong>);cursor=index+phrase.length;}
  if(cursor<value.length)parts.push(value.slice(cursor));return <>{parts}</>;
}
function TranslatedPreview({value}:{value:string}){return <article className="mx-auto max-w-4xl rounded-2xl border bg-white p-6 shadow-sm sm:p-10"><div className="mb-6 flex items-center gap-2 border-b pb-4"><FileText className="size-5 text-blue-600"/><h2 className="font-bold text-slate-900">Bản CV dịch tiếng Việt</h2></div><div className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{value}</div></article>}

function prPlainText(result:CvScanResult){const section=(title:string,items:string[])=>`${title}\n${items.map(item=>`+ ${item}`).join("\n")}`;return [result.prTitle,"",section("I. Lịch sử kinh nghiệm và Skill",result.experienceAndSkills),"",section("II. Học vấn và chứng chỉ",result.educationAndCertificates),"",section("III. Ghi chú thêm",result.additionalNotes),"",`File CV đã đọc: ${result.sourceFiles.join(", ")}`].join("\n")}
function documentHtml(result:CvScanResult){
  const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
  const emphasize=(value:string)=>{
    let html=esc(value);
    for(const phrase of [...result.importantPhrases].filter(Boolean).sort((a,b)=>b.length-a.length)){
      const escaped=esc(phrase);
      html=html.split(escaped).join(`<strong class="important">${escaped}</strong>`);
    }
    return html;
  };
  const list=(items:string[])=>items.map(item=>`<p>+ ${emphasize(item)}</p>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(result.candidateName)} - PR</title><style>@page{margin:22mm}body{font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:900px;margin:auto}h1{font-size:20px}h2{font-size:15px;margin-top:24px}.important{color:#dc2626}.page{page-break-before:always}.translated{white-space:pre-wrap}</style></head><body><h1>${esc(result.prTitle)}</h1><h2>I. Lịch sử kinh nghiệm và Skill</h2>${list(result.experienceAndSkills)}<h2>II. Học vấn và chứng chỉ</h2>${list(result.educationAndCertificates)}<h2>III. Ghi chú thêm</h2>${list(result.additionalNotes)}<p><b>File CV đã đọc:</b> ${esc(result.sourceFiles.join(", "))}</p><div class="page"><h1>CV dịch tiếng Việt - ${esc(result.candidateName)}</h1><div class="translated">${esc(result.translatedCvMarkdown)}</div></div></body></html>`;
}
function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}
function safeFilename(value:string){return value.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"ung-vien"}
function formatBytes(value:number){return value<1024?`${value} B`:value<1024*1024?`${(value/1024).toFixed(1)} KB`:`${(value/(1024*1024)).toFixed(1)} MB`}
function errorMessage(code:string){return code==="AI_NOT_CONFIGURED"?"OpenAI chưa được cấu hình.":code==="INVALID_FILE_COUNT"?"Hãy chọn từ 1 đến 10 tệp.":code==="INVALID_FILE"?"Định dạng hoặc dung lượng tệp không hợp lệ.":code==="AI_UNAVAILABLE"?"OpenAI chưa đọc được CV. Hãy thử lại hoặc giảm số tệp.":"Không thể Scan CV lúc này. Hãy thử lại."}
