"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, LoaderCircle, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteContactChannel } from "@/modules/crm/contact-channels/server/delete-contact-channel";
import type { ContactChannel } from "@/modules/crm/contact-channels/types/contact-channel";
import { initialDeleteContactChannelState } from "@/modules/crm/contact-channels/types/delete-contact-channel-state";

interface Props {
  contactId: string;
  channel: ContactChannel;
  onClose: () => void;
  onDeleted: (message: string) => void;
}

export function DeleteContactChannelDialog({ contactId, channel, onClose, onDeleted }: Props) {
  const [state, formAction, pending] = useActionState(
    deleteContactChannel,
    initialDeleteContactChannelState,
  );

  useEffect(() => {
    if (state.success && state.message) onDeleted(state.message);
  }, [state, onDeleted]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-channel-title">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Close delete channel dialog" onClick={onClose} disabled={pending} />
      <div className="relative w-full max-w-md rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div><h2 id="delete-channel-title" className="text-xl font-bold tracking-tight">Delete contact channel?</h2><p className="mt-1 text-sm text-slate-500">This action cannot be undone.</p></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={pending} aria-label="Close dialog"><X className="size-5" /></Button>
        </div>
        <form action={formAction} className="space-y-5 p-6">
          <input type="hidden" name="contactId" value={contactId} />
          <input type="hidden" name="channelId" value={channel.id} />
          <div className="rounded-lg border bg-slate-50 p-4"><p className="text-xs font-semibold tracking-wide text-slate-500">{channel.channelType}</p><p className="mt-1 break-all text-sm font-semibold text-slate-900">{channel.channelValue}</p>{channel.isPrimary && <p className="mt-2 text-xs font-medium text-blue-700">Primary channel</p>}</div>
          <div className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><Trash2 className="mt-0.5 size-4 shrink-0" /><p>Deleting this channel permanently removes it from the contact. No replacement primary will be selected.</p></div>
          {state.message && !state.success && <div className="flex gap-2 rounded-lg border border-rose-200 bg-white p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{state.message}</div>}
          <div className="flex justify-end gap-3 border-t pt-5"><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><button type="submit" disabled={pending} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:pointer-events-none disabled:opacity-50">{pending ? <><LoaderCircle className="size-4 animate-spin" />Deleting...</> : "Delete Channel"}</button></div>
        </form>
      </div>
    </div>
  );
}
