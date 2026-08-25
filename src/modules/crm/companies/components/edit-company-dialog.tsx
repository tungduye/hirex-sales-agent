"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateCompany } from "@/modules/crm/companies/server/update-company";
import { COMPANY_STATUSES, type CompanyListItem } from "@/modules/crm/companies/types/company";
import { initialUpdateCompanyState } from "@/modules/crm/companies/types/create-company-state";

export function EditCompanyDialog({ company, onClose, onUpdated }: { company: CompanyListItem; onClose: () => void; onUpdated: (message: string) => void }) {
  const [state, formAction, pending] = useActionState(updateCompany, initialUpdateCompanyState);

  useEffect(() => {
    if (state.success && state.message) onUpdated(state.message);
  }, [state, onUpdated]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="edit-company-title">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Close edit company dialog" onClick={onClose} disabled={pending} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b px-6 py-5"><div><h2 id="edit-company-title" className="text-xl font-bold tracking-tight">Edit Company</h2><p className="mt-1 text-sm text-slate-500">Update company details in your current workspace.</p></div><Button type="button" variant="ghost" size="icon" onClick={onClose} disabled={pending} aria-label="Close dialog"><X className="size-5" /></Button></div>
        <form action={formAction} className="space-y-5 p-6">
          <input type="hidden" name="companyId" value={company.id} />
          <Field label="Company Name" name="name" defaultValue={company.name} required error={state.fieldErrors?.name?.[0]} disabled={pending} />
          <Field label="Website" name="website" defaultValue={company.website ?? ""} error={state.fieldErrors?.website?.[0]} disabled={pending} />
          <div className="grid gap-5 sm:grid-cols-2"><Field label="Industry" name="industry" defaultValue={company.industry ?? ""} error={state.fieldErrors?.industry?.[0]} disabled={pending} /><Field label="Country" name="country" defaultValue={company.country ?? ""} error={state.fieldErrors?.country?.[0]} disabled={pending} /></div>
          <div className="space-y-2"><label htmlFor="edit-status" className="text-sm font-semibold text-slate-700">Status</label><select id="edit-status" name="status" defaultValue={company.status} disabled={pending} className="h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60">{COMPANY_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select>{state.fieldErrors?.status?.[0] && <p className="text-xs text-rose-600">{state.fieldErrors.status[0]}</p>}</div>
          {state.message && !state.success && <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{state.message}</div>}
          <div className="flex justify-end gap-3 border-t pt-5"><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? <><LoaderCircle className="size-4 animate-spin" />Saving...</> : "Save Changes"}</Button></div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, name, defaultValue, error, required, disabled }: { label: string; name: string; defaultValue: string; error?: string; required?: boolean; disabled: boolean }) {
  return <div className="space-y-2"><label htmlFor={`edit-${name}`} className="text-sm font-semibold text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</label><input id={`edit-${name}`} name={name} defaultValue={defaultValue} required={required} disabled={disabled} className="h-11 w-full rounded-lg border bg-slate-50 px-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none disabled:opacity-60" />{error && <p className="text-xs text-rose-600">{error}</p>}</div>;
}
