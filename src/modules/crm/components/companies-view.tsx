"use client";

import { useMemo, useState } from "react";
import { Building2, ExternalLink, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { companies } from "@/modules/crm/data/mock-crm";
import { StatusBadge } from "@/modules/crm/components/status-badge";

export function CompaniesView() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => companies.filter((company) => [company.name, company.website, company.industry, company.country].some((value) => value.toLowerCase().includes(query.toLowerCase()))), [query]);

  return (
    <>
      <PageHeader title="Companies" description="Manage accounts and the people connected to them." action={<Button><Plus className="size-4" />Add Company</Button>} />
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-lg border bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" placeholder="Search companies..." /></div><span className="text-xs font-medium text-slate-500">{filtered.length} companies</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Company</th><th className="px-4 py-3 font-semibold">Industry</th><th className="px-4 py-3 font-semibold">Country</th><th className="px-4 py-3 text-center font-semibold">Contacts</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Created</th></tr></thead><tbody className="divide-y">{filtered.map((company) => <tr key={company.id} className="transition-colors hover:bg-slate-50/70"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Building2 className="size-4" /></div><div><p className="text-sm font-semibold">{company.name}</p><p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">{company.website}<ExternalLink className="size-3" /></p></div></div></td><td className="px-4 py-4 text-sm text-slate-600">{company.industry}</td><td className="px-4 py-4 text-sm text-slate-600">{company.country}</td><td className="px-4 py-4 text-center text-sm font-semibold">{company.contactCount}</td><td className="px-4 py-4"><StatusBadge status={company.status} /></td><td className="px-5 py-4 text-sm text-slate-500">{company.createdAt}</td></tr>)}</tbody></table></div>
        {filtered.length === 0 && <div className="px-5 py-14 text-center text-sm text-slate-500">No companies match “{query}”.</div>}
      </div>
    </>
  );
}
