"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, ExternalLink, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/modules/crm/components/status-badge";
import { AddCompanyDialog } from "@/modules/crm/companies/components/add-company-dialog";
import type { CompanyListItem } from "@/modules/crm/companies/types/company";

const dateFormatter = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" });

export function CompaniesView({ companies, loadError }: { companies: CompanyListItem[]; loadError: string | null }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return companies;
    return companies.filter((company) => [company.name, company.website, company.industry, company.country].some((value) => value?.toLowerCase().includes(normalizedQuery)));
  }, [companies, query]);

  const handleCreated = useCallback((message: string) => {
    setDialogOpen(false);
    setSuccessMessage(message);
    router.refresh();
  }, [router]);

  const addButton = <Button onClick={() => { setSuccessMessage(null); setDialogOpen(true); }}><Plus className="size-4" />Add Company</Button>;

  return (
    <>
      <PageHeader title="Companies" description="Manage accounts and the people connected to them." action={addButton} />
      {successMessage && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status">{successMessage}</div>}
      {loadError ? <div className="rounded-xl border border-rose-200 bg-white p-8 text-center shadow-sm"><AlertCircle className="mx-auto size-8 text-rose-500" /><h2 className="mt-3 font-semibold">Unable to load companies</h2><p className="mt-1 text-sm text-slate-500">{loadError}</p><Button variant="outline" className="mt-5" onClick={() => router.refresh()}>Try again</Button></div> : companies.length === 0 ? <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center shadow-sm"><div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Building2 className="size-7" /></div><h2 className="mt-5 text-xl font-bold">No companies yet</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Add your first company to start organizing accounts and customer relationships.</p><div className="mt-6">{addButton}</div></div> : <div className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-lg border bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" placeholder="Search companies..." /></div><span className="text-xs font-medium text-slate-500">{filtered.length} companies</span></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Company</th><th className="px-4 py-3 font-semibold">Industry</th><th className="px-4 py-3 font-semibold">Country</th><th className="px-4 py-3 text-center font-semibold">Contacts</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Created</th></tr></thead><tbody className="divide-y">{filtered.map((company) => <tr key={company.id} className="transition-colors hover:bg-slate-50/70"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Building2 className="size-4" /></div><div><p className="text-sm font-semibold">{company.name}</p><p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">{company.website ?? "No website"}{company.website && <ExternalLink className="size-3" />}</p></div></div></td><td className="px-4 py-4 text-sm text-slate-600">{company.industry ?? "—"}</td><td className="px-4 py-4 text-sm text-slate-600">{company.country ?? "—"}</td><td className="px-4 py-4 text-center text-sm font-semibold">{company.contactCount}</td><td className="px-4 py-4"><StatusBadge status={company.status} /></td><td className="px-5 py-4 text-sm text-slate-500">{dateFormatter.format(new Date(company.createdAt))}</td></tr>)}</tbody></table></div>{filtered.length === 0 && <div className="px-5 py-14 text-center text-sm text-slate-500">No companies match “{query}”.</div>}</div>}
      {dialogOpen && <AddCompanyDialog onClose={() => setDialogOpen(false)} onCreated={handleCreated} />}
    </>
  );
}
