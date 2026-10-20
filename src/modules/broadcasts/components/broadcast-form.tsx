"use client";

import { ArrowLeft, Megaphone, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { createBroadcastAction, loadBroadcastGroupsAction } from "../server/broadcast-actions";
import type { GroupOption, NickOption } from "../server/broadcast-data";

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/gu, "d").toLowerCase();
const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400";

export function BroadcastForm({ nicks }: { nicks: NickOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [sendMessage, setSendMessage] = useState(true);
  const [pinNote, setPinNote] = useState(false);
  const [cap, setCap] = useState(30);
  const [chosenNicks, setChosenNicks] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [chosenGroups, setChosenGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => (groups ?? []).filter((group) => !search || fold(group.name).includes(fold(search))), [groups, search]);
  const toggle = (set: Set<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  const nickName = new Map(nicks.map((nick) => [nick.id, nick.name]));
  const limit = pinNote ? 2000 : 4000;
  const loadGroups = () => startLoading(async () => { const list = await loadBroadcastGroupsAction([...chosenNicks]); setGroups(list); setChosenGroups(new Set()); });
  const submit = () => {
    setError(null);
    if (!name.trim() || !text.trim()) { setError("Cần tên và nội dung."); return; }
    if (!chosenGroups.size) { setError("Chưa chọn nhóm nào."); return; }
    startSaving(async () => {
      const result = await createBroadcastAction({ name, text, sendMessage, pinNote, accountIds: [...chosenNicks], groupIds: [...chosenGroups], dailyCapPerNick: cap });
      if (result.ok) router.push(`/broadcasts/${result.id}`); else setError(result.error);
    });
  };

  return <div className="space-y-5">
    <Link href="/broadcasts" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-blue-700"><ArrowLeft className="size-4"/>Gửi nhóm Zalo</Link>
    <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-950"><Megaphone className="size-6 text-blue-600"/>Tạo đợt gửi nhóm Zalo</h1>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-3.5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Tên đợt gửi *</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} className={inputClass} placeholder="Job BrSE HCM tuần 43"/></label>
        <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">Nội dung * <span className={text.length > limit ? "text-rose-600" : "text-slate-400"}>({text.length}/{limit})</span></span><textarea value={text} onChange={(event) => setText(event.target.value)} rows={10} className={inputClass} placeholder="[TUYỂN DỤNG] BrSE N2 – HCM – 60–70M…"/></label>
        <div className="flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={sendMessage} onChange={(event) => setSendMessage(event.target.checked)} className="size-4"/>Gửi tin vào nhóm</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={pinNote} onChange={(event) => setPinNote(event.target.checked)} className="size-4"/>Ghim lên đầu nhóm (ghi chú ghim)</label>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">Mỗi nick tối đa<input type="number" min={1} max={100} value={cap} onChange={(event) => setCap(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} className="h-8 w-20 rounded-lg border border-slate-200 px-2"/>nhóm/ngày</label>
        <p className="text-xs text-slate-500">Mỗi nick gửi lần lượt từng nhóm, cách nhau ngẫu nhiên 90–180 giây, chỉ từ 8:00 đến 21:00. Nên thử ít nhóm trước rồi tăng dần.</p>
      </section>
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">1. Chọn nick gửi ({chosenNicks.size})</p>
          <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {nicks.map((nick) => <label key={nick.id} className={`flex items-center gap-1.5 truncate text-sm ${nick.status === "CONNECTED" ? "" : "text-slate-400"}`}><input type="checkbox" checked={chosenNicks.has(nick.id)} onChange={() => setChosenNicks((current) => toggle(current, nick.id))} className="size-3.5"/>{nick.name}{nick.status === "CONNECTED" ? "" : " (mất kết nối)"}</label>)}
          </div>
          <button type="button" disabled={!chosenNicks.size || loading} onClick={loadGroups} className="mt-2 h-8 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">{loading ? "Đang tải nhóm…" : "Tải nhóm của các nick này"}</button>
        </div>
        {groups ? <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-600">2. Chọn nhóm ({chosenGroups.size}/{groups.length})</p>
            <span className="flex gap-2 text-xs"><button type="button" onClick={() => setChosenGroups(new Set([...chosenGroups, ...shown.slice(0, 500).map((group) => group.groupId)]))} className="font-semibold text-blue-700 hover:underline">Chọn tất cả đang hiện</button><button type="button" onClick={() => setChosenGroups(new Set())} className="font-semibold text-slate-500 hover:underline">Bỏ chọn</button></span></div>
          <label className="relative mb-2 block"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên nhóm…" className={`${inputClass} pl-8`}/></label>
          <div className="max-h-80 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {shown.map((group) => <label key={group.groupId} className="flex items-start gap-1.5 text-sm"><input type="checkbox" checked={chosenGroups.has(group.groupId)} onChange={() => setChosenGroups((current) => toggle(current, group.groupId))} className="mt-0.5 size-3.5"/><span className="min-w-0"><span className="block truncate">{group.name}</span><span className="block truncate text-[11px] text-slate-400">{group.accounts.map((item) => nickName.get(item.accountId)).join(", ")}</span></span></label>)}
            {shown.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">Không có nhóm nào.</p> : null}
          </div>
        </div> : null}
      </section>
    </div>
    <div className="flex items-center justify-end gap-3">
      {error ? <p className="mr-auto text-sm text-rose-600">{error}</p> : null}
      <p className="text-xs text-slate-500">Lưu xong vẫn là nháp; bấm “Bắt đầu gửi” ở trang tiếp theo mới gửi.</p>
      <button type="button" disabled={saving} onClick={submit} className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Đang lưu…" : `Lưu nháp (${chosenGroups.size} nhóm)`}</button>
    </div>
  </div>;
}
