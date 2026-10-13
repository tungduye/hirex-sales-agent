"use client";

import { useActionState } from "react";
import { setConversationTag, updateConversationControls } from "../server/channel-actions";
import type { ConversationStatus, TakeoverMode } from "../core/conversation-policy";
import type { ChannelActionState } from "../types/channel-action-state";

const initial: ChannelActionState = { status: "idle", message: null };

export function ConversationControls(props: {
  conversationId: string; status: ConversationStatus; takeoverMode: TakeoverMode;
  assignedTo: string | null; profiles: Array<{ id: string; fullName: string }>;
  tags: Array<{ id: string; name: string; color: string | null }>; tagIds: string[];
}) {
  const [state, action, pending] = useActionState(updateConversationControls, initial);
  return <div className="mt-3 space-y-2"><form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="conversationId" value={props.conversationId}/>
    <select name="status" defaultValue={props.status} className="h-8 rounded border bg-white px-2 text-xs" disabled={pending}><option value="OPEN">Đang mở</option><option value="PENDING">Đang chờ</option><option value="RESOLVED">Đã xử lý</option><option value="SPAM">Thư rác</option></select>
    <select name="takeoverMode" defaultValue={props.takeoverMode} className="h-8 rounded border bg-white px-2 text-xs" disabled={pending}><option value="BOT_ALLOWED">Cho phép AI hỗ trợ</option><option value="HUMAN_TAKEOVER">Nhân viên tiếp quản</option></select>
    <select name="assignedTo" defaultValue={props.assignedTo ?? ""} className="h-8 rounded border bg-white px-2 text-xs" disabled={pending}><option value="">Chưa phân công</option>{props.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName}</option>)}</select>
    <button disabled={pending} className="h-8 rounded bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">{pending ? "Đang lưu…" : "Lưu"}</button>
    {state.message ? <span className={`text-xs ${state.status === "error" ? "text-rose-600" : "text-emerald-600"}`}>{state.message}</span> : null}
  </form><div className="rounded-xl border border-slate-100 bg-slate-50/80 p-2"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Gán nhãn hội thoại</p><div className="flex flex-wrap gap-1">{props.tags.length === 0 ? <span className="text-xs text-slate-400">Tạo nhãn từ bộ lọc Nhãn phía trên.</span> : props.tags.map((tag) => <TagToggle key={tag.id} conversationId={props.conversationId} tag={tag} enabled={props.tagIds.includes(tag.id)}/>)}</div></div></div>;
}

function TagToggle({ conversationId, tag, enabled }: { conversationId: string; tag: { id: string; name: string; color: string | null }; enabled: boolean }) {
  const [, action, pending] = useActionState(setConversationTag, initial);
  return <form action={action}><input type="hidden" name="conversationId" value={conversationId}/><input type="hidden" name="tagId" value={tag.id}/><input type="hidden" name="enabled" value={enabled ? "false" : "true"}/><button disabled={pending} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold ${enabled ? "bg-white text-slate-800 shadow-sm" : "bg-white/60 text-slate-500"}`} style={tag.color ? { borderColor: tag.color } : undefined}><span className="size-2 rounded-full" style={{ backgroundColor: tag.color ?? "#64748b" }}/>{enabled ? "✓ " : "+ "}{tag.name}</button></form>;
}
