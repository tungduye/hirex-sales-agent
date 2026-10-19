"use client";

import { AlertTriangle, BriefcaseBusiness, Download, EyeOff, FileUp, Plus, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CAREER_TRACKS, isStale, JAPANESE_LEVELS, JOB_PRIORITY_LABEL, JOB_STATUS_LABEL, JOB_STATUSES, locationGroup, WORK_MODES, type Job, type JobStatus } from "../core/job-fields";
import { importJobs, saveJob, setJobStatus, type JobActionState, type JobImportResult } from "../server/job-actions";

const initial: JobActionState = { status: "idle", message: null };
const STATUS_STYLE: Record<JobStatus, string> = {
  OPEN: "border-emerald-200 bg-emerald-50 text-emerald-700", PAUSED: "border-amber-200 bg-amber-50 text-amber-700", CLOSED: "border-slate-200 bg-slate-100 text-slate-500",
};
const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").toLowerCase();
function ago(iso: string, now: number) {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "Hôm nay" : days === 1 ? "Hôm qua" : days < 30 ? `${days} ngày trước` : `${Math.floor(days / 30)} tháng trước`;
}

export function JobsView({ jobs, canManage, members, canCreateContent = false }: { jobs: Job[]; canManage: boolean; members: Array<{ id: string; name: string }>; canCreateContent?: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<JobStatus | "ALL">("OPEN");
  const [track, setTrack] = useState("");
  const [area, setArea] = useState("");
  const [editing, setEditing] = useState<Job | "new" | null>(null);
  const [now] = useState(() => Date.now());
  const tracks = useMemo(() => [...new Set(jobs.map((job) => job.careerTrack))].sort(), [jobs]);
  const areas = useMemo(() => [...new Set(jobs.map((job) => locationGroup(job.location)))].sort(), [jobs]);
  const counts = useMemo(() => Object.fromEntries(JOB_STATUSES.map((value) => [value, jobs.filter((job) => job.status === value).length])) as Record<JobStatus, number>, [jobs]);
  const visible = useMemo(() => {
    const needle = fold(query.trim());
    return jobs.filter((job) => (status === "ALL" || job.status === status) && (!track || job.careerTrack === track) && (!area || locationGroup(job.location) === area) &&
      (!needle || fold(`${job.code} ${job.title} ${job.companyName} ${job.location} ${job.careerTrack}`).includes(needle)));
  }, [jobs, query, status, track, area]);
  const stale = jobs.filter((job) => job.status === "OPEN" && isStale(job.updatedAt, now)).length;

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950"><BriefcaseBusiness className="size-6 text-blue-600"/>Job</h1>
        <p className="mt-1 text-sm text-slate-500">Danh sách job đang tuyển. Hola và Hole chỉ giới thiệu job <b className="font-semibold text-slate-700">Đang tuyển</b> và chỉ dùng đúng thông tin ở đây.</p>
      </div>
      {canManage ? <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { window.location.href = "/api/jobs/template"; }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download className="size-4"/>File mẫu</button>
        <ImportButton/>
        <button type="button" onClick={() => setEditing("new")} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus className="size-4"/>Thêm job</button>
      </div> : null}
    </header>

    {stale > 0 ? <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="size-4 shrink-0"/>{stale} job đang tuyển đã hơn 30 ngày chưa cập nhật. Kiểm tra lại để AI không giới thiệu job cũ.</p> : null}

    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <label className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm vị trí, công ty, địa điểm, mã job…" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:bg-white"/></label>
        <div className="flex items-center gap-1" role="group" aria-label="Trạng thái">
          {(["ALL", ...JOB_STATUSES] as const).map((value) => <button key={value} type="button" onClick={() => setStatus(value)} aria-pressed={status === value} className={`h-8 rounded-full border px-3 text-xs font-semibold ${status === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>{value === "ALL" ? `Tất cả ${jobs.length}` : `${JOB_STATUS_LABEL[value]} ${counts[value]}`}</button>)}
        </div>
        <select value={track} onChange={(event) => setTrack(event.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700" aria-label="Hướng nghề"><option value="">Mọi hướng nghề</option>{tracks.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select value={area} onChange={(event) => setArea(event.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700" aria-label="Khu vực"><option value="">Mọi khu vực</option>{areas.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr>
            <th className="px-3 py-2.5">Mã</th><th className="px-3 py-2.5">Vị trí</th><th className="px-3 py-2.5">Công ty</th><th className="px-3 py-2.5">Địa điểm</th>
            <th className="px-3 py-2.5">Tiếng Nhật</th><th className="px-3 py-2.5">Lương</th><th className="px-3 py-2.5">Trạng thái</th><th className="px-3 py-2.5">Cập nhật</th>{canCreateContent && <th className="px-3 py-2.5"><span className="sr-only">Content</span></th>}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((job) => <tr key={job.id} onClick={() => setEditing(job)} className="cursor-pointer hover:bg-blue-50/40">
              <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-slate-500">{job.code}</td>
              <td className="px-3 py-2.5"><p className="font-semibold text-slate-900">{job.title}</p><p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">{job.careerTrack}</span>{job.priority === "HIGH" ? <span className="rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700">Ưu tiên</span> : null}</p></td>
              <td className="px-3 py-2.5 text-slate-700"><span className="inline-flex items-center gap-1">{job.companyName}{!job.companyNamePublic ? <EyeOff className="size-3.5 text-slate-400" aria-label="Không nói tên công ty"/> : null}</span></td>
              <td className="px-3 py-2.5 text-slate-700">{job.location}{job.workMode ? <span className="text-xs text-slate-400"> · {job.workMode}</span> : null}</td>
              <td className="px-3 py-2.5 text-slate-700">{job.japaneseLevelMin ?? "—"}</td>
              <td className="px-3 py-2.5 text-slate-700">{job.salaryRange ?? "—"}</td>
              <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>{canManage ? <StatusSelect job={job}/> : <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[job.status]}`}>{JOB_STATUS_LABEL[job.status]}</span>}</td>
              <td className={`whitespace-nowrap px-3 py-2.5 text-xs ${job.status === "OPEN" && isStale(job.updatedAt, now) ? "font-semibold text-amber-700" : "text-slate-500"}`}>{ago(job.updatedAt, now)}{job.ownerName ? <p className="text-slate-400">{job.ownerName}</p> : null}</td>
              {canCreateContent && <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>{job.status === "OPEN" && <Link href={`/content/new?job=${job.id}`} title="Tạo content đăng tuyển cho job này" className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"><Sparkles className="size-3.5"/>Tạo content</Link>}</td>}
            </tr>)}
          </tbody>
        </table>
        {visible.length === 0 ? <p className="px-4 py-12 text-center text-sm text-slate-500">{jobs.length === 0 ? (canManage ? "Chưa có job nào. Bấm \"Thêm job\" hoặc nhập từ file Excel mẫu." : "Chưa có job nào.") : "Không có job khớp bộ lọc."}</p> : null}
      </div>
    </div>
    {editing ? <JobForm key={editing === "new" ? "new" : editing.id} job={editing === "new" ? null : editing} readOnly={!canManage} members={members} onClose={() => setEditing(null)}/> : null}
  </div>;
}

function StatusSelect({ job }: { job: Job }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <span className="inline-flex flex-col">
    <select value={job.status} disabled={pending} onChange={(event) => { const next = event.target.value; start(async () => { const result = await setJobStatus({ id: job.id, status: next }); setError(result.status === "error" ? result.message : null); }); }}
      className={`h-7 rounded-full border px-2 text-xs font-semibold ${STATUS_STYLE[job.status]} disabled:opacity-60`} aria-label={`Trạng thái ${job.title}`}>
      {JOB_STATUSES.map((value) => <option key={value} value={value}>{JOB_STATUS_LABEL[value]}</option>)}
    </select>
    {error ? <span className="mt-0.5 text-[11px] text-rose-600">{error}</span> : null}
  </span>;
}

function ImportButton() {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<JobImportResult | null>(null);
  return <>
    <input ref={input} type="file" accept=".xlsx" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; const data = new FormData(); data.set("file", file); start(async () => setResult(await importJobs(data))); }}/>
    <button type="button" disabled={pending} onClick={() => input.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{pending ? <span className="size-4 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"/> : <FileUp className="size-4"/>}Nhập Excel</button>
    {result ? <div role="dialog" aria-label="Kết quả nhập" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setResult(null)}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <p className={`font-semibold ${result.status === "success" ? "text-emerald-700" : "text-rose-700"}`}>{result.message}</p>
        {result.problems.length ? <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-sm text-slate-600">{result.problems.map((problem) => <li key={`${problem.row}:${problem.error}`}>Dòng {problem.row}: {problem.error}</li>)}</ul> : null}
        <button type="button" onClick={() => setResult(null)} className="mt-4 h-9 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">Đóng</button>
      </div>
    </div> : null}
  </>;
}

function Field({ label, children, wide = false, hint }: { label: string; children: React.ReactNode; wide?: boolean; hint?: string }) {
  return <label className={`block ${wide ? "sm:col-span-2" : ""}`}><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>{children}{hint ? <span className="mt-1 block text-[11px] text-slate-400">{hint}</span> : null}</label>;
}
const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-600";

function JobForm({ job, readOnly, members, onClose }: { job: Job | null; readOnly: boolean; members: Array<{ id: string; name: string }>; onClose: () => void }) {
  const [state, save, pending] = useActionState(saveJob, initial);
  useEffect(() => { if (state.status === "success") onClose(); }, [state, onClose]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  const value = (key: keyof Job) => (job?.[key] as string | null | undefined) ?? "";
  return <div role="dialog" aria-label={job ? `Job ${job.title}` : "Thêm job"} className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onClick={onClose}>
    <form action={save} onClick={(event) => event.stopPropagation()} className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5"><h2 className="font-bold text-slate-900">{job ? (readOnly ? job.title : `Sửa job ${job.code}`) : "Thêm job"}</h2><button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-5"/></button></div>
      <fieldset disabled={readOnly || pending} className="grid flex-1 grid-cols-1 gap-3.5 overflow-y-auto px-5 py-4 sm:grid-cols-2">
        {job ? <input type="hidden" name="id" value={job.id}/> : null}
        <Field label="Vị trí *"><input name="title" required maxLength={200} defaultValue={value("title")} className={inputClass} placeholder="BrSE"/></Field>
        <Field label="Hướng nghề *"><input name="careerTrack" required maxLength={60} list="job-tracks" defaultValue={value("careerTrack")} className={inputClass} placeholder="BrSE / PM / SE / Developer…"/><datalist id="job-tracks">{CAREER_TRACKS.map((item) => <option key={item} value={item}/>)}</datalist></Field>
        <Field label="Công ty *"><input name="companyName" required maxLength={200} defaultValue={value("companyName")} className={inputClass}/></Field>
        <Field label="Mã job" hint="Để trống: tự tạo"><input name="code" maxLength={40} defaultValue={value("code")} className={inputClass} placeholder="J-0001"/></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2"><input type="checkbox" name="companyNamePublic" defaultChecked={job ? job.companyNamePublic : true} className="size-4 rounded border-slate-300"/>Được nói tên công ty với ứng viên</label>
        <Field label="Địa điểm *"><input name="location" required maxLength={200} defaultValue={value("location")} className={inputClass} placeholder="Hà Nội (Mễ Trì)"/></Field>
        <Field label="Hình thức"><input name="workMode" maxLength={40} list="job-modes" defaultValue={value("workMode")} className={inputClass}/><datalist id="job-modes">{WORK_MODES.map((item) => <option key={item} value={item}/>)}</datalist></Field>
        <Field label="Tiếng Nhật tối thiểu"><input name="japaneseLevelMin" maxLength={40} list="job-japanese" defaultValue={value("japaneseLevelMin")} className={inputClass}/><datalist id="job-japanese">{JAPANESE_LEVELS.map((item) => <option key={item} value={item}/>)}</datalist></Field>
        <Field label="Kinh nghiệm tối thiểu"><input name="experienceMin" maxLength={120} defaultValue={value("experienceMin")} className={inputClass} placeholder="3 năm; không cần từng ở Nhật"/></Field>
        <Field label="Khoảng lương"><input name="salaryRange" maxLength={120} defaultValue={value("salaryRange")} className={inputClass} placeholder="30–45 triệu gross"/></Field>
        <Field label="Link JD"><input name="jdLink" type="url" maxLength={1000} defaultValue={value("jdLink")} className={inputClass} placeholder="https://…"/></Field>
        <Field label="Điểm hấp dẫn" wide><textarea name="sellingPoints" rows={2} maxLength={2000} defaultValue={value("sellingPoints")} className={inputClass}/></Field>
        <Field label="Mô tả công việc" wide><textarea name="summary" rows={3} maxLength={3000} defaultValue={value("summary")} className={inputClass}/></Field>
        <Field label="Yêu cầu chính" wide><textarea name="requirements" rows={3} maxLength={3000} defaultValue={value("requirements")} className={inputClass}/></Field>
        <Field label="Quy trình phỏng vấn" wide><input name="interviewProcess" maxLength={1000} defaultValue={value("interviewProcess")} className={inputClass} placeholder="2 vòng, khoảng 2 tuần"/></Field>
        <Field label="Trạng thái"><select name="status" defaultValue={job?.status ?? "OPEN"} className={inputClass}>{JOB_STATUSES.map((item) => <option key={item} value={item}>{JOB_STATUS_LABEL[item]}</option>)}</select></Field>
        <Field label="Ưu tiên"><select name="priority" defaultValue={job?.priority ?? "NORMAL"} className={inputClass}>{(["HIGH", "NORMAL"] as const).map((item) => <option key={item} value={item}>{JOB_PRIORITY_LABEL[item]}</option>)}</select></Field>
        <Field label="Người phụ trách"><select name="ownerId" defaultValue={job?.ownerId ?? ""} className={inputClass}><option value="">—</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></Field>
        <Field label="Ghi chú nội bộ" wide hint="Chỉ team thấy; AI không đưa ghi chú này cho ứng viên."><textarea name="note" rows={2} maxLength={2000} defaultValue={value("note")} className={inputClass}/></Field>
      </fieldset>
      {!readOnly ? <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
        {state.status === "error" ? <p className="mr-auto text-sm text-rose-600">{state.message}</p> : null}
        <button type="button" onClick={onClose} className="h-9 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Huỷ</button>
        <button type="submit" disabled={pending} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{pending ? "Đang lưu…" : job ? "Lưu" : "Thêm job"}</button>
      </div> : null}
    </form>
  </div>;
}
