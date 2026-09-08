"use client";

import { useActionState } from "react";
import { CHANNEL_TYPES } from "../core/channel-contracts";
import { deleteQuickReply, saveQuickReply } from "../server/channel-actions";
import type { ChannelActionState } from "../types/channel-action-state";
import type { QuickReplyTemplate } from "../types/quick-reply";

const initial: ChannelActionState = { status: "idle", message: null };

export function QuickRepliesManager({ templates, error }: { templates: QuickReplyTemplate[]; error: string | null }) {
  const [state, action, pending] = useActionState(saveQuickReply, initial);
  return <section className="rounded-xl border bg-white p-5"><div><h2 className="font-semibold">Quick replies</h2><p className="text-sm text-slate-500">Reusable human-authored replies available by shortcut.</p></div>{error ? <p className="mt-4 text-sm text-amber-700">{error}</p> : null}<form action={action} className="mt-5 grid gap-3 lg:grid-cols-2"><input name="name" required maxLength={100} placeholder="Name" className="rounded-lg border px-3 py-2 text-sm"/><input name="shortcut" required maxLength={40} placeholder="Shortcut, e.g. pricing" className="rounded-lg border px-3 py-2 text-sm"/><textarea name="textContent" required maxLength={100000} placeholder="Reply text" className="min-h-24 rounded-lg border px-3 py-2 text-sm lg:col-span-2"/><fieldset className="flex flex-wrap gap-3 lg:col-span-2"><legend className="mb-2 text-xs font-semibold text-slate-500">Channels</legend>{CHANNEL_TYPES.map((type) => <label key={type} className="flex items-center gap-1 text-xs"><input type="checkbox" name="channelTypes" value={type}/>{type}</label>)}</fieldset><button disabled={pending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving…" : "Add quick reply"}</button>{state.message ? <p className={`self-center text-sm ${state.status === "error" ? "text-rose-600" : "text-emerald-600"}`}>{state.message}</p> : null}</form><div className="mt-5 divide-y">{templates.map((template) => <QuickReplyRow key={template.id} template={template}/>)}</div></section>;
}

function QuickReplyRow({ template }: { template: QuickReplyTemplate }) {
  const [state, action, pending] = useActionState(deleteQuickReply, initial);
  return <div className="flex items-start justify-between gap-4 py-3"><div><p className="text-sm font-semibold">/{template.shortcut} · {template.name}</p><p className="mt-1 line-clamp-2 text-sm text-slate-500">{template.textContent}</p><p className="mt-1 text-xs text-slate-400">{template.channelTypes.length ? template.channelTypes.join(" · ") : "All configured channels"}</p>{state.message ? <p className="mt-1 text-xs text-rose-600">{state.message}</p> : null}</div><form action={action}><input type="hidden" name="id" value={template.id}/><button disabled={pending} className="rounded border px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50">Delete</button></form></div>;
}
