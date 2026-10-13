"use client";

import { useActionState, useMemo, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import { CheckCircle2, FileSpreadsheet, MessageCircle, Search, ShieldCheck, Upload, Users } from "lucide-react";
import { createChannelCampaign } from "../server/channel-campaign-actions";
import type { ChannelActionState } from "../types/channel-action-state";

const initial: ChannelActionState = { status: "idle", message: null };

export function NewChannelCampaignForm({ contacts, senders }: {
  contacts: Array<{ id: string; full_name: string; zalo_channel_id: string; zalo_id: string; marketing_consent_status: string; phone_numbers: string[] }>;
  senders: Array<{ id: string; channel_type: string; display_name: string | null; external_account_id: string }>;
}) {
  const [state, action, pending] = useActionState(createChannelCampaign, initial);
  const [messages, setMessages] = useState([""]);
  const [activeMessage, setActiveMessage] = useState(0);
  const message = messages[activeMessage] ?? "";
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedSenderIds, setSelectedSenderIds] = useState<Set<string>>(new Set());
  const [importResult, setImportResult] = useState<{ total: number; valid: number; matched: number; unmatched: string[] } | null>(null);
  const [readingFile, setReadingFile] = useState(false);
  const [queuedPhones, setQueuedPhones] = useState<string[]>([]);
  const allContacts = contacts;
  const eligible = useMemo(() => allContacts.filter((contact) => contact.marketing_consent_status === "OPTED_IN"), [allContacts]);
  const visible = useMemo(() => eligible.filter((contact) => `${contact.full_name} ${contact.zalo_id}`.toLowerCase().includes(query.trim().toLowerCase())), [eligible, query]);
  const contactsByPhone = useMemo(() => {
    const result = new Map<string, typeof contacts[number]>();
    for (const contact of allContacts) for (const phone of contact.phone_numbers) { const normalized = normalizeVietnamPhone(phone); if (normalized) result.set(normalized, contact); }
    return result;
  }, [allContacts]);

  async function importPhones(file: File | undefined) {
    if (!file) return;
    setReadingFile(true);
    try {
      const rawValues = file.name.toLowerCase().endsWith(".xlsx")
        ? (await readXlsxFile(file)).flat().map(String)
        : (await file.text()).split(/[\s,;|]+/u);
      const normalized = [...new Set(rawValues.map(normalizeVietnamPhone).filter((value): value is string => Boolean(value)))];
      const matched = normalized.flatMap((phone) => { const contact = contactsByPhone.get(phone); return contact ? [contact] : []; });
      const unresolved = normalized.filter((phone) => !contactsByPhone.has(phone));
      setSelectedIds(new Set(matched.map((contact) => contact.id)));
      setQueuedPhones(unresolved);
      setImportResult({ total: rawValues.filter((value) => value.trim()).length, valid: normalized.length, matched: new Set(matched.map((contact) => contact.id)).size, unmatched: unresolved });
    } finally { setReadingFile(false); }
  }

  return <form action={action} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
    <input type="hidden" name="channels" value="ZALO" />
    {queuedPhones.map((phone) => <input key={phone} type="hidden" name="phoneRecipients" value={phone} />)}
    {[...selectedIds].map((id) => <input key={id} type="hidden" name="contactIds" value={id} />)}
    <div className="space-y-5">
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><MessageCircle className="size-5" /></span><div><h2 className="font-bold">1. Nội dung chiến dịch</h2><p className="text-xs text-slate-500">Tin nhắn văn bản gửi qua tài khoản Zalo đã kết nối.</p></div></div>
        <label className="block text-sm font-semibold">Tên chiến dịch<input name="name" required maxLength={160} placeholder="Ví dụ: Chăm sóc khách hàng tháng 9" className="mt-2 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:border-blue-400" /></label>
        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_110px]"><label className="text-sm font-semibold">Loại chiến dịch<input name="campaignType" required maxLength={100} defaultValue="Zalo Marketing" className="mt-2 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:border-blue-400" /></label><label className="text-sm font-semibold">Màu nhãn<input name="campaignTypeColor" type="color" defaultValue="#2563eb" className="mt-2 h-11 w-full rounded-xl border bg-white p-1" /></label></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Combo UV <span className="font-normal text-slate-400">(không bắt buộc)</span><input name="comboUv" maxLength={200} placeholder="Ví dụ: 95016 - [Data Rec] IT JP" className="mt-2 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:border-blue-400" /></label><label className="text-sm font-semibold">Vị trí <span className="font-normal text-slate-400">(không bắt buộc)</span><input name="placement" maxLength={200} placeholder="Ví dụ: 7222 - Brse/PM" className="mt-2 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:border-blue-400" /></label><label className="text-sm font-semibold">Xếp hạng kênh <span className="font-normal text-slate-400">(không bắt buộc)</span><input name="channelRank" maxLength={200} placeholder="Ví dụ: 200416 - Tương tác" className="mt-2 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:border-blue-400" /></label><label className="text-sm font-semibold">Owner <span className="font-normal text-slate-400">(không bắt buộc)</span><input name="ownerName" maxLength={200} placeholder="Mã Owner, ví dụ: 125" className="mt-2 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:border-blue-400" /></label><label className="text-sm font-semibold sm:col-span-2">Xếp hạng AM <span className="font-normal text-slate-400">(không bắt buộc)</span><input name="amRank" maxLength={200} placeholder="Ví dụ: 200268 - [R&D] Tổng tương tác" className="mt-2 h-11 w-full rounded-xl border px-3 font-normal outline-none focus:border-blue-400" /></label></div>
        <div className="mt-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="Các mẫu nội dung Zalo">
          {messages.map((_, index) => <button key={index} type="button" role="tab" aria-selected={activeMessage === index} onClick={() => setActiveMessage(index)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${activeMessage === index ? "border-blue-500 bg-blue-50 text-blue-700" : "text-slate-600"}`}>Nội dung {index + 1}</button>)}
          <button type="button" disabled={messages.length >= 10} onClick={() => { setMessages((current) => [...current, ""]); setActiveMessage(messages.length); }} className="rounded-lg border border-dashed px-3 py-2 text-sm font-semibold text-blue-700 disabled:opacity-40">+ Thêm nội dung</button>
          {messages.length > 1 ? <button type="button" onClick={() => { setMessages((current) => current.filter((_, index) => index !== activeMessage)); setActiveMessage((current) => Math.max(0, current - 1)); }} className="ml-auto rounded-lg px-3 py-2 text-sm font-semibold text-rose-600">Xóa mẫu này</button> : null}
        </div>
        {messages.map((variant, index) => index === activeMessage ? <label key={index} className="mt-3 block text-sm font-semibold">Mẫu {index + 1}<textarea name="messageVariants" maxLength={100000} value={variant} onChange={(event) => setMessages((current) => current.map((value, item) => item === index ? event.target.value : value))} placeholder="Soạn nội dung tin nhắn…" className="mt-2 min-h-44 w-full resize-y rounded-xl border px-3 py-3 font-normal outline-none focus:border-blue-400" /></label> : <input key={index} type="hidden" name="messageVariants" value={variant} />)}
        <div className="mt-3 flex justify-between text-xs text-slate-500"><span>Mỗi người nhận được chọn ngẫu nhiên một mẫu; gửi thử lại sẽ giữ nguyên mẫu đã chọn.</span><span>{message.length.toLocaleString("vi-VN")} ký tự</span></div>
      </section>
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3"><Users className="size-5 text-blue-600" /><div><h2 className="font-bold">2. Người nhận</h2><p className="text-xs text-slate-500">Chỉ hiển thị liên hệ có Zalo và đã đồng ý nhận marketing.</p></div></div>
        <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><strong>Tra cứu khi chiến dịch chạy</strong><p className="mt-1 text-xs text-blue-800">HireX lưu SĐT trong bản nháp. Khi chạy, hệ thống mới tìm UID Zalo; số không tìm thấy được ghi “Không tìm thấy Zalo”, các số còn lại vẫn tiếp tục.</p></div>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-5 text-center hover:border-blue-400"><Upload className="size-6 text-blue-600"/><strong className="mt-2 text-sm">Tải file danh sách SĐT</strong><span className="mt-1 text-xs text-slate-500">Hỗ trợ XLSX, CSV hoặc TXT — mỗi số một dòng hoặc một ô</span><input type="file" accept=".xlsx,.csv,.txt,text/csv,text/plain" className="sr-only" disabled={readingFile} onChange={(event) => void importPhones(event.target.files?.[0])}/></label>
        {readingFile ? <p className="mt-3 text-sm text-blue-600">Đang đọc và đối chiếu file…</p> : null}
        {importResult ? <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm"><p className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="size-4 text-blue-600"/>Đã đọc {importResult.total} dòng · {importResult.valid} SĐT hợp lệ · {importResult.matched} liên hệ Zalo sẵn sàng · {queuedPhones.length} SĐT chờ tra cứu khi chạy</p>{importResult.unmatched.length > 0 ? <details className="mt-2 text-xs text-amber-700"><summary className="cursor-pointer font-semibold">Xem {importResult.unmatched.length} SĐT chờ tra cứu</summary><p className="mt-2 break-all">{importResult.unmatched.slice(0, 50).join(", ")}{importResult.unmatched.length > 50 ? "…" : ""}</p></details> : null}</div> : null}
        <div className="mt-3 flex items-center justify-between gap-3"><label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border px-3"><Search className="size-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo tên hoặc Zalo ID" className="w-full text-sm outline-none" /></label><button type="button" onClick={() => setSelectedIds(new Set(eligible.map((contact) => contact.id)))} className="h-10 rounded-xl border px-3 text-xs font-semibold">Chọn tất cả</button><button type="button" onClick={() => setSelectedIds(new Set())} className="h-10 rounded-xl border px-3 text-xs font-semibold">Bỏ chọn</button></div>
        <div className="mt-3 max-h-72 divide-y overflow-y-auto rounded-xl border">{visible.map((contact) => <label key={contact.id} className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-slate-50"><input type="checkbox" checked={selectedIds.has(contact.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(contact.id); else next.delete(contact.id); return next; })}/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{contact.full_name}</strong><span className="block truncate text-xs text-slate-500">Zalo ID: {contact.zalo_id}{contact.phone_numbers.length ? ` · ${contact.phone_numbers.join(", ")}` : ""}</span></span><CheckCircle2 className="size-4 text-emerald-500" /></label>)}{visible.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">Không có người nhận Zalo đủ điều kiện.</p> : null}</div>
        <p className="mt-2 text-xs text-slate-500">Đã chọn {selectedIds.size} · {eligible.length} liên hệ đủ điều kiện trong tổng số {allContacts.length} liên hệ Zalo.</p>
      </section>
      <section className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="font-bold">3. Tài khoản gửi và lịch gửi</h2>
        <fieldset className="mt-4"><legend className="text-sm font-semibold">Tài khoản Zalo được sử dụng</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{senders.map((sender) => <label key={sender.id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 hover:border-blue-300"><input type="checkbox" name="senderIds" value={sender.id} checked={selectedSenderIds.has(sender.id)} onChange={(event) => setSelectedSenderIds((current) => { const next = new Set(current); if (event.target.checked) next.add(sender.id); else next.delete(sender.id); return next; })} /><span><strong className="block text-sm">{sender.display_name ?? sender.external_account_id}</strong><span className="text-xs text-slate-500">Zalo đã kết nối</span></span></label>)}{senders.length === 0 ? <p className="text-sm text-rose-600">Chưa có tài khoản Zalo khả dụng hoặc anh chưa được cấp quyền.</p> : null}</div>{senders.length > 0 && selectedSenderIds.size === 0 ? <p className="mt-2 text-sm text-amber-700">Chọn ít nhất một tài khoản Zalo gửi để tiếp tục.</p> : null}</fieldset>
        <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
          <h3 className="text-sm font-bold text-slate-900">Nhịp gửi an toàn</h3>
          <p className="mt-1 text-xs text-slate-600">Giới hạn áp dụng cho toàn chiến dịch, kể cả khi chọn nhiều tài khoản gửi.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Trễ trước tin đầu tiên (phút)<input name="delayMinutes" type="number" min="0" max="525600" defaultValue="0" className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-normal outline-none focus:border-blue-400" /></label>
            <label className="text-sm font-semibold">Giới hạn tin gửi mỗi ngày<input name="dailyMessageLimit" type="number" min="1" max="5000" defaultValue="100" className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-normal outline-none focus:border-blue-400" /></label>
            <label className="text-sm font-semibold">Nghỉ ngẫu nhiên tối thiểu (giây)<input name="minDelaySeconds" type="number" min="5" max="86400" defaultValue="30" className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-normal outline-none focus:border-blue-400" /></label>
            <label className="text-sm font-semibold">Nghỉ ngẫu nhiên tối đa (giây)<input name="maxDelaySeconds" type="number" min="5" max="86400" defaultValue="90" className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-normal outline-none focus:border-blue-400" /></label>
            <label className="text-sm font-semibold">Số tin trong một đợt<input name="batchSize" type="number" min="1" max="1000" defaultValue="10" className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-normal outline-none focus:border-blue-400" /></label>
            <label className="text-sm font-semibold">Nghỉ sau mỗi đợt (phút)<input name="batchPauseMinutes" type="number" min="1" max="1440" defaultValue="15" className="mt-2 h-11 w-full rounded-xl border bg-white px-3 font-normal outline-none focus:border-blue-400" /></label>
          </div>
          <p className="mt-3 text-xs text-slate-500">Ví dụ mặc định: tối đa 100 tin/ngày, mỗi tin cách nhau ngẫu nhiên 30–90 giây; gửi đủ 10 tin thì nghỉ 15 phút.</p>
        </div>
      </section>
      {state.message ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{state.message}</p> : null}
      {selectedIds.size === 0 && queuedPhones.length === 0 ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Chưa có người nhận. Hãy tải file SĐT hoặc chọn liên hệ Zalo đã có trong CRM.</p> : null}
      <button disabled={pending || messages.some((value) => !value.trim()) || selectedSenderIds.size === 0 || selectedIds.size + queuedPhones.length === 0} className="w-full rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Đang tạo bản nháp…" : "Tạo bản nháp để xem lại"}</button>
    </div>
    <aside className="xl:sticky xl:top-5 xl:self-start"><div className="rounded-2xl border bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Xem trước</p><div className="mt-4 min-h-64 rounded-2xl bg-slate-100 p-4"><div className="rounded-2xl rounded-tl-sm bg-white p-3 text-sm shadow-sm">{message.trim() || <span className="italic text-slate-400">Nội dung Zalo sẽ hiển thị tại đây…</span>}</div></div><div className="mt-4 flex gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800"><ShieldCheck className="size-4 shrink-0" /><span>Tạo chiến dịch không gửi ngay. Anh phải xem lại và xác nhận chạy ở bước tiếp theo.</span></div></div></aside>
  </form>;
}

function normalizeVietnamPhone(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  let value = String(input).trim().replace(/[^\d+]/gu, "");
  if (value.startsWith("+84")) value = `0${value.slice(3)}`;
  else if (value.startsWith("84") && value.length >= 11) value = `0${value.slice(2)}`;
  if (!/^0(3|5|7|8|9)\d{8}$/u.test(value)) return null;
  return value;
}
