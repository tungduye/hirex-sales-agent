"use client";

import { useMemo, useState } from "react";
import { Mail, Phone, Plus, Search, SlidersHorizontal } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { contacts } from "@/modules/crm/data/mock-crm";
import { StatusBadge } from "@/modules/crm/components/status-badge";
import { LEAD_STATUSES, type LeadStatus } from "@/types/crm";

export function ContactsView() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LeadStatus | "ALL">("ALL");
  const filtered = useMemo(() => contacts.filter((contact) => {
    const matchesQuery = [contact.fullName, contact.company, contact.email, contact.jobTitle].some((value) => value.toLowerCase().includes(query.toLowerCase()));
    return matchesQuery && (status === "ALL" || contact.leadStatus === status);
  }), [query, status]);

  return (
    <>
      <PageHeader title="Contacts" description="Track every lead and relationship from one canonical contact record." action={<Button><Plus className="size-4" />Add Contact</Button>} />
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center"><div className="relative w-full lg:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-lg border bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" placeholder="Search contacts..." /></div><div className="relative"><SlidersHorizontal className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><select value={status} onChange={(event) => setStatus(event.target.value as LeadStatus | "ALL")} className="h-10 min-w-48 appearance-none rounded-lg border bg-white pl-9 pr-8 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none"><option value="ALL">All lead statuses</option>{LEAD_STATUSES.map((leadStatus) => <option key={leadStatus} value={leadStatus}>{leadStatus.replaceAll("_", " ")}</option>)}</select></div><span className="ml-auto text-xs font-medium text-slate-500">{filtered.length} contacts</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Contact</th><th className="px-4 py-3 font-semibold">Company & role</th><th className="px-4 py-3 font-semibold">Contact details</th><th className="px-4 py-3 font-semibold">Country</th><th className="px-4 py-3 font-semibold">Source</th><th className="px-4 py-3 font-semibold">Lead status</th><th className="px-5 py-3 text-right font-semibold">Score</th></tr></thead><tbody className="divide-y">{filtered.map((contact) => <tr key={contact.id} className="transition-colors hover:bg-slate-50/70"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{contact.initials}</div><span className="text-sm font-semibold">{contact.fullName}</span></div></td><td className="px-4 py-4"><p className="text-sm font-medium">{contact.company}</p><p className="mt-0.5 text-xs text-slate-500">{contact.jobTitle}</p></td><td className="px-4 py-4"><p className="flex items-center gap-1.5 text-xs text-slate-600"><Mail className="size-3.5 text-slate-400" />{contact.email}</p><p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><Phone className="size-3.5 text-slate-400" />{contact.phone}</p></td><td className="px-4 py-4 text-sm text-slate-600">{contact.country}</td><td className="px-4 py-4 text-sm text-slate-600">{contact.source}</td><td className="px-4 py-4"><StatusBadge status={contact.leadStatus} /></td><td className="px-5 py-4"><div className="flex items-center justify-end gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${contact.leadScore}%` }} /></div><span className="w-6 text-right text-sm font-bold">{contact.leadScore}</span></div></td></tr>)}</tbody></table></div>
        {filtered.length === 0 && <div className="px-5 py-14 text-center text-sm text-slate-500">No contacts match the current filters.</div>}
      </div>
    </>
  );
}
