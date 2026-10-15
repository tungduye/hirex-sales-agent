"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, LoaderCircle, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { setConversationTag } from "@/modules/channels/server/channel-actions";
import { addCustomerNote, createContactForConversation, createConversationTask, setConversationTaskDone, setCustomerLeadStatus } from "../server/customer-panel-actions";
import { LEAD_STATUSES, type CustomerPanelData, type CustomerPanelResult } from "../types/customer-panel";
import type { OmnichannelInboxTag } from "../types/omnichannel-inbox";

const sectionTitle = "text-[11px] font-bold uppercase tracking-wide text-slate-500";
const chip = "inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400 disabled:opacity-50";

export function CustomerInfoPanel(props: { conversationId: string; displayName: string; avatarUrl: string | null; senderExternalId: string | null; tags: OmnichannelInboxTag[]; tagIds: string[]; canUpdateConversation: boolean; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<CustomerPanelData | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<CustomerPanelResult | null>(null);
  const [busy, startBusy] = useTransition();

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/inbox/conversations/${props.conversationId}/customer`, { cache: "no-store" });
      if (!response.ok) throw new Error("LOAD_FAILED");
      setData(await response.json() as CustomerPanelData); setFailed(false);
    } catch { setFailed(true); }
  }, [props.conversationId]);
  useEffect(() => { setData(null); setMessage(null); void load(); }, [load]);

  /** Runs one change, shows its result, then reloads the panel. */
  function run(action: () => Promise<CustomerPanelResult>, refreshPage = false) {
    startBusy(async () => {
      const result = await action();
      setMessage(result);
      if (result.ok) { await load(); if (refreshPage) router.refresh(); }
    });
  }

  return <aside aria-label="Thông tin khách" className="absolute inset-y-0 right-0 z-30 flex w-[300px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-xl 2xl:static 2xl:shadow-none">
    <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3.5">
      <p className="text-[13px] font-bold text-slate-700">Thông tin khách</p>
      <button type="button" onClick={props.onClose} aria-label="Thu gọn thông tin khách" title="Thu gọn" className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"><ChevronRight className="size-4"/></button>
    </div>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-5 pt-2">
      {failed ? <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Chưa tải được thông tin khách. <button type="button" onClick={() => void load()} className="font-semibold underline">Thử lại</button></p> : null}
      {!data && !failed ? <div className="flex justify-center py-10 text-slate-400"><LoaderCircle className="size-5 animate-spin"/></div> : null}
      {data ? <>
        <Identity data={data} displayName={props.displayName} avatarUrl={props.avatarUrl} senderExternalId={props.senderExternalId} busy={busy} onCreate={(name, phone) => run(() => createContactForConversation(props.conversationId, name, phone), true)}/>

        {data.contact ? <section className="space-y-1.5">
          <label htmlFor="panel-lead" className={sectionTitle}>Trạng thái lead</label>
          <select id="panel-lead" value={data.contact.leadStatus} disabled={!data.can.editLead || busy} onChange={(event) => run(() => setCustomerLeadStatus(props.conversationId, event.target.value))} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500" title={data.can.editLead ? undefined : "Cần quyền Sửa liên hệ"}>
            {LEAD_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </section> : null}

        <Tags tags={props.tags} tagIds={props.tagIds} canEdit={props.canUpdateConversation} busy={busy} onToggle={(tagId, enabled) => run(async () => {
          const form = new FormData(); form.set("conversationId", props.conversationId); form.set("tagId", tagId); form.set("enabled", enabled ? "true" : "false");
          const result = await setConversationTag({ status: "idle", message: null }, form);
          return { ok: result.status === "success", message: result.status === "success" ? (enabled ? "Đã gắn nhãn." : "Đã bỏ nhãn.") : result.message ?? "Chưa đổi được nhãn." };
        }, true)}/>

        <Tasks data={data} busy={busy} onCreate={(title, dueAt) => run(() => createConversationTask(props.conversationId, title, dueAt))} onToggle={(taskId, done) => run(() => setConversationTaskDone(props.conversationId, taskId, done))}/>

        <Notes data={data} busy={busy} onAdd={(content) => run(() => addCustomerNote(props.conversationId, content))}/>

        {data.otherConversations.length ? <section className="space-y-1.5">
          <p className={sectionTitle}>Cùng người ở kênh khác</p>
          {data.otherConversations.map((item) => <Link key={item.id} href={`/inbox/all/${item.id}`} className="block rounded-[10px] border border-slate-200 px-2.5 py-2 text-[13px] text-slate-900 hover:border-blue-300 hover:bg-blue-50/40">
            {channelName(item.channelType)}{item.accountName ? ` · ${item.accountName}` : ""}{item.subject ? ` · ${item.subject}` : ""}
            {item.lastMessageAt ? <span className="block text-xs text-slate-500">{relative(item.lastMessageAt)}</span> : null}
          </Link>)}
        </section> : null}

        {message ? <p aria-live="polite" className={`text-xs ${message.ok ? "text-emerald-700" : "text-rose-600"}`}>{message.message}</p> : null}
      </> : null}
    </div>
  </aside>;
}

function Identity({ data, displayName, avatarUrl, senderExternalId, busy, onCreate }: { data: CustomerPanelData; displayName: string; avatarUrl: string | null; senderExternalId: string | null; busy: boolean; onCreate: (name: string, phone: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(displayName === "Khách chưa rõ tên" ? "" : displayName);
  const [phone, setPhone] = useState("");
  const contact = data.contact;
  const title = contact?.fullName ?? displayName;
  const subtitle = contact ? [contact.jobTitle, contact.companyName].filter(Boolean).join(" · ") : null;
  return <section className="flex flex-col items-center gap-1 text-center">
    {avatarUrl ? <Image unoptimized src={avatarUrl} alt="" width={56} height={56} className="size-14 rounded-full bg-slate-100 object-cover"/> : <span className="flex size-14 items-center justify-center rounded-full bg-violet-600 text-lg font-bold text-white">{initials(title)}</span>}
    <p className="mt-1 text-base font-bold text-slate-950">{title}</p>
    {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
    {contact?.phone || contact?.email ? <p className="text-xs text-slate-600">{[contact.phone, contact.email].filter(Boolean).join(" · ")}</p> : null}
    {contact ? <Link href={`/contacts/${contact.id}`} className="text-[13px] font-semibold text-blue-700 hover:underline">Mở trang liên hệ</Link>
    : !creating ? <div className="mt-1 space-y-1.5"><p className="text-xs text-slate-500">Chưa gắn với liên hệ nào{senderExternalId && /^[\w.+-]+@/u.test(senderExternalId) ? ` (${senderExternalId})` : ""}.</p>{data.can.createContact ? <button type="button" onClick={() => setCreating(true)} className={chip}><Plus className="size-3.5"/>Tạo liên hệ</button> : null}</div>
    : <form onSubmit={(event) => { event.preventDefault(); onCreate(name, phone); }} className="mt-2 w-full space-y-1.5 rounded-lg border border-slate-200 p-2.5 text-left">
      <label className="block text-[11px] font-semibold text-slate-600">Họ tên<input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className="mt-0.5 h-8 w-full rounded-md border border-slate-200 px-2 text-[13px] font-normal outline-none focus:border-blue-400"/></label>
      <label className="block text-[11px] font-semibold text-slate-600">Số điện thoại (không bắt buộc)<input maxLength={40} inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-0.5 h-8 w-full rounded-md border border-slate-200 px-2 text-[13px] font-normal outline-none focus:border-blue-400"/></label>
      <div className="flex justify-end gap-1.5 pt-0.5"><button type="button" onClick={() => setCreating(false)} className="h-8 px-2 text-xs text-slate-500 hover:text-slate-800">Hủy</button><button disabled={busy || !name.trim()} className="h-8 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50">Tạo và gắn</button></div>
    </form>}
  </section>;
}

function Tags({ tags, tagIds, canEdit, busy, onToggle }: { tags: OmnichannelInboxTag[]; tagIds: string[]; canEdit: boolean; busy: boolean; onToggle: (tagId: string, enabled: boolean) => void }) {
  const [adding, setAdding] = useState(false);
  const current = tags.filter((tag) => tagIds.includes(tag.id));
  const others = tags.filter((tag) => !tagIds.includes(tag.id));
  return <section className="space-y-1.5">
    <p className={sectionTitle}>Nhãn</p>
    <div className="flex flex-wrap gap-1.5">
      {current.map((tag) => <span key={tag.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-slate-700"><span className="size-2 rounded-full" style={{ background: tag.color ?? "#94a3b8" }}/>{tag.name}{canEdit ? <button type="button" disabled={busy} onClick={() => onToggle(tag.id, false)} aria-label={`Bỏ nhãn ${tag.name}`} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"><X className="size-3"/></button> : null}</span>)}
      {current.length === 0 && !canEdit ? <span className="text-xs text-slate-500">Chưa có nhãn.</span> : null}
      {canEdit && others.length ? <button type="button" onClick={() => setAdding((value) => !value)} className={chip}><Plus className="size-3.5"/>Thêm</button> : null}
    </div>
    {adding ? <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-100 bg-slate-50 p-2">{others.map((tag) => <button key={tag.id} type="button" disabled={busy} onClick={() => { onToggle(tag.id, true); setAdding(false); }} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-blue-300"><span className="size-2 rounded-full" style={{ background: tag.color ?? "#94a3b8" }}/>{tag.name}</button>)}</div> : null}
  </section>;
}

function Tasks({ data, busy, onCreate, onToggle }: { data: CustomerPanelData; busy: boolean; onCreate: (title: string, dueAt: string | null) => void; onToggle: (taskId: string, done: boolean) => void }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  return <section className="space-y-1.5">
    <p className={sectionTitle}>Công việc</p>
    {data.tasks.map((task) => { const done = task.status === "COMPLETED"; const late = !done && task.dueAt && Date.parse(task.dueAt) < Date.now(); return <label key={task.id} className={`flex items-start gap-2 rounded-[10px] border border-slate-200 p-2.5 ${done ? "opacity-60" : ""}`}>
      <input type="checkbox" checked={done} disabled={!data.can.updateTask || busy} onChange={(event) => onToggle(task.id, event.target.checked)} className="mt-0.5 size-4 accent-blue-600" aria-label={`Hoàn thành: ${task.title}`}/>
      <span className="min-w-0 text-[13px] leading-snug"><span className={done ? "line-through" : ""}>{task.title}</span>{task.dueAt || task.assigneeName ? <span className={`block text-xs ${late ? "font-semibold text-rose-700" : "text-amber-700"}`}>{task.dueAt ? `Hạn ${dueText(task.dueAt)}` : ""}{task.dueAt && task.assigneeName ? " · " : ""}{task.assigneeName ? <span className="text-slate-500">{task.assigneeName}</span> : null}</span> : null}</span>
    </label>; })}
    {data.tasks.length === 0 && !creating ? <p className="text-xs text-slate-500">Chưa có công việc cho khách này.</p> : null}
    {creating ? <form onSubmit={(event) => { event.preventDefault(); onCreate(title, due ? new Date(due).toISOString() : null); setTitle(""); setDue(""); setCreating(false); }} className="space-y-1.5 rounded-lg border border-slate-200 p-2.5">
      <input autoFocus required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Gọi lại hỏi kết quả PV" className="h-8 w-full rounded-md border border-slate-200 px-2 text-[13px] outline-none focus:border-blue-400"/>
      <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">Hạn<input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 px-1.5 text-xs font-normal outline-none focus:border-blue-400"/></label>
      <div className="flex justify-end gap-1.5"><button type="button" onClick={() => setCreating(false)} className="h-8 px-2 text-xs text-slate-500 hover:text-slate-800">Hủy</button><button disabled={busy || !title.trim()} className="h-8 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50">Tạo</button></div>
    </form> : data.can.createTask ? <button type="button" onClick={() => setCreating(true)} className={chip}><Plus className="size-3.5"/>Tạo công việc</button> : null}
  </section>;
}

function Notes({ data, busy, onAdd }: { data: CustomerPanelData; busy: boolean; onAdd: (content: string) => void }) {
  const [text, setText] = useState("");
  const canWrite = data.can.addNote && data.contact !== null;
  return <section className="space-y-1.5">
    <label htmlFor="panel-note" className={sectionTitle}>Ghi chú nội bộ</label>
    {canWrite ? <form onSubmit={(event) => { event.preventDefault(); onAdd(text); setText(""); }} className="space-y-1.5">
      <textarea id="panel-note" rows={3} maxLength={5000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Chỉ người trong team thấy…" className="w-full resize-y rounded-lg border border-slate-200 p-2 text-[13px] outline-none focus:border-blue-400"/>
      {text.trim() ? <div className="flex justify-end"><button disabled={busy} className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">Lưu ghi chú</button></div> : null}
    </form> : <p className="text-xs text-slate-500">{data.contact ? "Anh/chị chưa có quyền thêm ghi chú." : "Tạo liên hệ cho khách để lưu ghi chú."}</p>}
    {data.notes.map((note) => <div key={note.id} className="rounded-lg bg-amber-50/70 px-2.5 py-2 text-[13px] text-slate-800"><p className="whitespace-pre-wrap break-words">{note.content}</p><p className="mt-1 text-[11px] text-slate-500">{note.authorName ?? "Thành viên"} · {relative(note.createdAt)}</p></div>)}
  </section>;
}

function initials(name: string) { const words = name.replace(/@.*$/u, "").split(/[\s._-]+/u).filter(Boolean); const pick = words.length > 1 ? [words[words.length - 2], words[words.length - 1]] : words; return pick.map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?"; }
function channelName(channel: string) { return channel === "EMAIL" ? "Email" : channel === "FACEBOOK" ? "Facebook Page" : channel === "FACEBOOK_PROFILE" ? "Facebook cá nhân" : channel === "ZALO" ? "Zalo" : channel; }
function dueText(iso: string) { const date = new Date(iso); const today = new Date(); const time = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(date); return date.toDateString() === today.toDateString() ? `${time} hôm nay` : `${time} ${new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(date)}`; }
function relative(iso: string) { const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000); if (!Number.isFinite(minutes)) return ""; if (minutes < 60) return `${Math.max(1, minutes)} phút trước`; if (minutes < 1440) return `${Math.floor(minutes / 60)} giờ trước`; return `${Math.floor(minutes / 1440)} ngày trước`; }
