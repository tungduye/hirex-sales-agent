"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AtSign, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddContactChannelDialog } from "@/modules/crm/contact-channels/components/add-contact-channel-dialog";
import type { ContactChannel } from "@/modules/crm/contact-channels/types/contact-channel";

interface Props {
  contactId: string;
  channels: ContactChannel[];
  loadError: string | null;
}

export function ContactChannelsSection({ contactId, channels, loadError }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleCreated = useCallback((message: string) => {
    setDialogOpen(false);
    setSuccessMessage(message);
    router.refresh();
  }, [router]);

  return (
    <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div><h2 className="font-semibold">Contact Channels</h2><p className="mt-0.5 text-xs text-slate-500">Channel identities connected to this contact.</p></div>
        <Button size="sm" onClick={() => { setSuccessMessage(null); setDialogOpen(true); }}><Plus className="size-4" /> Add Channel</Button>
      </div>
      {successMessage && <div className="mx-5 mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status">{successMessage}</div>}
      {loadError ? (
        <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center"><AlertCircle className="size-7 text-rose-500" /><p className="mt-3 text-sm font-semibold text-slate-700">Unable to load contact channels</p><p className="mt-1 text-xs text-slate-500">{loadError}</p><Button variant="outline" size="sm" className="mt-4" onClick={() => router.refresh()}>Try again</Button></div>
      ) : channels.length === 0 ? (
        <div className="flex min-h-44 flex-col items-center justify-center px-5 py-8 text-center"><div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><AtSign className="size-5" /></div><p className="mt-3 text-sm font-semibold text-slate-700">No contact channels yet</p><p className="mt-1 text-xs text-slate-500">Add a channel to reach this contact.</p></div>
      ) : (
        <div className="divide-y">{channels.map((channel) => <div key={channel.id} className="flex items-center gap-4 px-5 py-4"><div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><AtSign className="size-4" /></div><div className="min-w-0 flex-1"><p className="text-xs font-semibold tracking-wide text-slate-500">{channel.channelType}</p><p className="mt-0.5 break-all text-sm font-medium text-slate-900">{channel.channelValue}</p></div>{channel.isPrimary && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">Primary</span>}</div>)}</div>
      )}
      {dialogOpen && <AddContactChannelDialog contactId={contactId} onClose={() => setDialogOpen(false)} onCreated={handleCreated} />}
    </section>
  );
}
