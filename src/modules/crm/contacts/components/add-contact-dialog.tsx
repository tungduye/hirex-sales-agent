"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createContact } from "@/modules/crm/contacts/server/create-contact";
import type { CompanyOption } from "@/modules/crm/contacts/types/contact";
import { initialCreateContactState } from "@/modules/crm/contacts/types/create-contact-state";
import { LEAD_STATUSES } from "@/types/crm";

export function AddContactDialog({ companies, onClose, onCreated }: { companies: CompanyOption[]; onClose: () => void; onCreated: (message: string) => void }) {
  const [state, formAction, pending] = useActionState(createContact, initialCreateContactState);

  useEffect(() => {
    if (state.success && state.message) onCreated(state.message);
  }, [state, onCreated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="add-contact-title">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Close add contact dialog" onClick={onClose} disabled={pending} />
      <div className="relative max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-white px-6 py-5"><div><h2 id="add-contact-title" className="text-xl font-bold tracking-tight">Add Contact</h2><p className="mt-1 text-sm text-slate-500">Create a contact in your current workspace.</p></div><Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={pending} aria-label="Close dialog"><X className="size-5" /></Button></div>
        <form action={formAction} className="space-y-5 p-6">
          <Field label="Full Name" name="fullName" required error={state.fieldErrors?.fullName?.[0]} disabled={pending} placeholder="Olivia Martin" />
          <div className="space-y-2"><label htmlFor="companyId" className="text-sm font-semibold text-slate-700">Company</label><select id="companyId" name="companyId" defaultValue="" disabled={pending} className="h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60"><option value="">No company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>{state.fieldErrors?.companyId?.[0] && <p className="text-xs text-rose-600">{state.fieldErrors.companyId[0]}</p>}</div>
          <div className="grid gap-5 sm:grid-cols-2"><Field label="Job Title" name="jobTitle" error={state.fieldErrors?.jobTitle?.[0]} disabled={pending} placeholder="VP of Sales" /><Field label="Email" name="email" type="email" error={state.fieldErrors?.email?.[0]} disabled={pending} placeholder="olivia@company.com" /></div>
          <div className="grid gap-5 sm:grid-cols-2"><Field label="Phone" name="phone" type="tel" error={state.fieldErrors?.phone?.[0]} disabled={pending} placeholder="+1 415 555 0142" /><Field label="Country" name="country" error={state.fieldErrors?.country?.[0]} disabled={pending} placeholder="United States" /></div>
          <div className="grid gap-5 sm:grid-cols-2"><Field label="Language" name="language" error={state.fieldErrors?.language?.[0]} disabled={pending} placeholder="English" /><Field label="Source" name="source" error={state.fieldErrors?.source?.[0]} disabled={pending} placeholder="Referral" /></div>
          <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="leadStatus" className="text-sm font-semibold text-slate-700">Lead Status</label><select id="leadStatus" name="leadStatus" defaultValue="NEW" disabled={pending} className="h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60">{LEAD_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select>{state.fieldErrors?.leadStatus?.[0] && <p className="text-xs text-rose-600">{state.fieldErrors.leadStatus[0]}</p>}</div><Field label="Lead Score" name="leadScore" type="number" defaultValue="0" min={0} max={100} error={state.fieldErrors?.leadScore?.[0]} disabled={pending} placeholder="0" /></div>
          {state.message && !state.success && <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{state.message}</div>}
          <div className="flex justify-end gap-3 border-t pt-5"><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? <><LoaderCircle className="size-4 animate-spin" />Saving...</> : "Add Contact"}</Button></div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, name, error, required, disabled, placeholder, type = "text", defaultValue, min, max }: { label: string; name: string; error?: string; required?: boolean; disabled: boolean; placeholder: string; type?: string; defaultValue?: string; min?: number; max?: number }) {
  return <div className="space-y-2"><label htmlFor={name} className="text-sm font-semibold text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</label><input id={name} name={name} type={type} defaultValue={defaultValue} min={min} max={max} required={required} disabled={disabled} placeholder={placeholder} className="h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60" />{error && <p className="text-xs text-rose-600">{error}</p>}</div>;
}
