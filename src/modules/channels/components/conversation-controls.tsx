"use client";

import { useActionState } from "react";
import { setConversationTag, updateConversationControls } from "../server/channel-actions";
import type { ConversationStatus, TakeoverMode } from "../core/conversation-policy";
import type { ChannelActionState } from "../types/channel-action-state";
import { AutoSubmitSelect } from "@/modules/inbox/components/auto-submit-select";

const initial: ChannelActionState = { status: "idle", message: null };

export function ConversationControls(props: {
  conversationId: string; status: ConversationStatus; takeoverMode: TakeoverMode;
  assignedTo: string | null; profiles: Array<{ id: string; fullName: string }>;
  tags: Array<{ id: string; name: string; color: string | null }>; tagIds: string[];
}) {
  const [state, action, pending] = useActionState(updateConversationControls, initial);
  // Each change saves at once (no "Lưu" click); the hidden button keeps the form usable without JavaScript.
  const field = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm disabled:opacity-60";
  const label = "text-[11px] font-bold uppercase tracking-wide text-slate-500";
  return <div className="space-y-3"><form action={action} className="space-y-2">
    <input type="hidden" name="conversationId" value={props.conversationId}/>
    <label className="block space-y-1"><span className={label}>Trạng thái</span><AutoSubmitSelect name="status" defaultValue={props.status} className={field} disabled={pending}><option value="OPEN">Đang mở</option><option value="PENDING">Đang chờ</option><option value="RESOLVED">Đã xử lý</option><option value="SPAM">Thư rác</option></AutoSubmitSelect></label>
    <label className="block space-y-1"><span className={label}>Người phụ trách</span><AutoSubmitSelect name="assignedTo" defaultValue={props.assignedTo ?? ""} className={field} disabled={pending}><option value="">Chưa phân công</option>{props.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.fullName}</option>)}</AutoSubmitSelect></label>
    <label className="block space-y-1"><span className={label}>AI hỗ trợ</span><AutoSubmitSelect name="takeoverMode" defaultValue={props.takeoverMode} className={field} disabled={pending}><option value="BOT_ALLOWED">Cho phép AI hỗ trợ</option><option value="HUMAN_TAKEOVER">Nhân viên tiếp quản</option></AutoSubmitSelect></label>
    <button className="sr-only">Lưu</button>
    <p className="min-h-4 text-xs" aria-live="polite">{pending ? <span className="text-slate-500">Đang lưu…</span> : state.message ? <span className={state.status === "error" ? "text-rose-600" : "text-emerald-600"}>{state.status === "error" ? state.message : "Đã lưu"}</span> : null}</p>
  </form><div><p className={`${label} mb-1.5`}>Nhãn hội thoại</p><div className="flex flex-wrap gap-1">{props.tags.length === 0 ? <span className="text-xs text-slate-400">Tạo nhãn trong bộ lọc Nhãn của danh sách.</span> : props.tags.map((tag) => <TagToggle key={tag.id} conversationId={props.conversationId} tag={tag} enabled={props.tagIds.includes(tag.id)}/>)}</div></div></div>;
}

function TagToggle({ conversationId, tag, enabled }: { conversationId: string; tag: { id: string; name: string; color: string | null }; enabled: boolean }) {
  const [, action, pending] = useActionState(setConversationTag, initial);
  return <form action={action}><input type="hidden" name="conversationId" value={conversationId}/><input type="hidden" name="tagId" value={tag.id}/><input type="hidden" name="enabled" value={enabled ? "false" : "true"}/><button disabled={pending} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold ${enabled ? "bg-white text-slate-800 shadow-sm" : "bg-white/60 text-slate-500"}`} style={tag.color ? { borderColor: tag.color } : undefined}><span className="size-2 rounded-full" style={{ backgroundColor: tag.color ?? "#64748b" }}/>{enabled ? "✓ " : "+ "}{tag.name}</button></form>;
}
