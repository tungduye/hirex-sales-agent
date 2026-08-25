"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, LoaderCircle, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteCompany } from "@/modules/crm/companies/server/delete-company";
import type { CompanyListItem } from "@/modules/crm/companies/types/company";
import { initialDeleteCompanyState } from "@/modules/crm/companies/types/delete-company-state";

export function DeleteCompanyDialog({ company, onClose, onDeleted }: { company: CompanyListItem; onClose: () => void; onDeleted: (message: string) => void }) {
  const [state, formAction, pending] = useActionState(deleteCompany, initialDeleteCompanyState);

  useEffect(() => {
    if (state.success && state.message) onDeleted(state.message);
  }, [state, onDeleted]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="delete-company-title" aria-describedby="delete-company-description">
      <button type="button" className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]" aria-label="Close delete company dialog" onClick={onClose} disabled={pending} />
      <div className="relative w-full max-w-md rounded-2xl border bg-white p-6 shadow-2xl">
        <Button type="button" variant="ghost" size="icon" className="absolute right-4 top-4" onClick={onClose} disabled={pending} aria-label="Close dialog"><X className="size-5" /></Button>
        <div className="flex size-12 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><Trash2 className="size-6" /></div>
        <h2 id="delete-company-title" className="mt-5 text-xl font-bold tracking-tight">Delete company?</h2>
        <p id="delete-company-description" className="mt-2 text-sm leading-6 text-slate-500">You are about to permanently delete <strong className="font-semibold text-slate-700">{company.name}</strong>. This action cannot be undone.</p>
        <form action={formAction} className="mt-6"><input type="hidden" name="companyId" value={company.id} />{state.message && !state.success && <div className="mb-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{state.message}</div>}<div className="flex justify-end gap-3"><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending} className="bg-rose-600 hover:bg-rose-700">{pending ? <><LoaderCircle className="size-4 animate-spin" />Deleting...</> : "Delete Company"}</Button></div></form>
      </div>
    </div>
  );
}
