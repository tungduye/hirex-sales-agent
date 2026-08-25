"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createContactChannel } from "@/modules/crm/contact-channels/server/create-contact-channel";
import { CHANNEL_TYPES } from "@/modules/crm/contact-channels/types/contact-channel";
import { initialCreateContactChannelState } from "@/modules/crm/contact-channels/types/create-contact-channel-state";

interface Props {
  contactId: string;
  onClose: () => void;
  onCreated: (message: string) => void;
}

export function AddContactChannelDialog({ contactId, onClose, onCreated }: Props) {
  const [state, formAction, pending] = useActionState(
    createContactChannel,
    initialCreateContactChannelState,
  );

  useEffect(() => {
    if (state.success && state.message) onCreated(state.message);
  }, [state, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="add-channel-title">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Close add channel dialog" onClick={onClose} disabled={pending} />
      <div className="relative w-full max-w-lg rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div><h2 id="add-channel-title" className="text-xl font-bold tracking-tight">Add Channel</h2><p className="mt-1 text-sm text-slate-500">Add a channel identity to this contact.</p></div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={pending} aria-label="Close dialog"><X className="size-5" /></Button>
        </div>
        <form action={formAction} className="space-y-5 p-6">
          <input type="hidden" name="contactId" value={contactId} />
          <div className="space-y-2">
            <label htmlFor="channelType" className="text-sm font-semibold text-slate-700">Channel Type</label>
            <select id="channelType" name="channelType" defaultValue="EMAIL" disabled={pending} className="h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60">
              {CHANNEL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            {state.fieldErrors?.channelType?.[0] && <p className="text-xs text-rose-600">{state.fieldErrors.channelType[0]}</p>}
          </div>
          <div className="space-y-2">
            <label htmlFor="channelValue" className="text-sm font-semibold text-slate-700">Channel Value <span className="text-rose-500">*</span></label>
            <input id="channelValue" name="channelValue" required maxLength={500} disabled={pending} placeholder="Email, phone number, or channel identifier" className="h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60" />
            {state.fieldErrors?.channelValue?.[0] && <p className="text-xs text-rose-600">{state.fieldErrors.channelValue[0]}</p>}
          </div>
          <label className="flex items-start gap-3 rounded-lg border bg-slate-50 p-4">
            <input type="checkbox" name="isPrimary" disabled={pending} className="mt-0.5 size-4 rounded border-slate-300 text-blue-600" />
            <span><span className="block text-sm font-semibold text-slate-700">Primary Channel</span><span className="mt-0.5 block text-xs text-slate-500">Mark this as the primary channel for its type.</span></span>
          </label>
          {state.message && !state.success && <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{state.message}</div>}
          <div className="flex justify-end gap-3 border-t pt-5">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? <><LoaderCircle className="size-4 animate-spin" />Saving...</> : "Add Channel"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
