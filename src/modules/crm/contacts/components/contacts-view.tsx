"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight, ContactRound, Mail, MoreHorizontal, Pencil, Phone, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/modules/crm/components/status-badge";
import { AddContactDialog } from "@/modules/crm/contacts/components/add-contact-dialog";
import { DeleteContactDialog } from "@/modules/crm/contacts/components/delete-contact-dialog";
import { EditContactDialog } from "@/modules/crm/contacts/components/edit-contact-dialog";
import type { CompanyOption, ContactListItem } from "@/modules/crm/contacts/types/contact";
import { LEAD_STATUSES, type LeadStatus } from "@/types/crm";
import { contactListHref, pageCount, type ContactListQuery } from "@/modules/crm/contacts/core/contact-list-query";

interface ContactsViewProps {
  contacts: ContactListItem[];
  companyOptions: CompanyOption[];
  total: number;
  workspaceTotal: number;
  query: ContactListQuery;
  loadError: string | null;
}

export function ContactsView({ contacts, companyOptions, total, workspaceTotal, query, loadError }: ContactsViewProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query.q);
  const [isNavigating, startNavigation] = useTransition();
  const lastSubmitted = useRef(query.q);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editContact, setEditContact] = useState<ContactListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactListItem | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Search and status filters run on the server across the whole workspace (see list-contacts.ts).
  const go = useCallback((next: Partial<Pick<ContactListQuery, "q" | "status" | "page">>) => {
    startNavigation(() => router.replace(contactListHref({ q: query.q, status: query.status, page: 1, ...next }), { scroll: false }));
  }, [router, query.q, query.status]);

  // Keep the box in step when the URL changes from outside (browser back/forward).
  useEffect(() => {
    if (query.q !== lastSubmitted.current) { lastSubmitted.current = query.q; setSearch(query.q); }
  }, [query.q]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === lastSubmitted.current) return;
    const timer = setTimeout(() => { lastSubmitted.current = trimmed; go({ q: trimmed, page: 1 }); }, 350);
    return () => clearTimeout(timer);
  }, [search, go]);

  const pages = pageCount(total, query.pageSize);
  const firstShown = total === 0 ? 0 : (query.page - 1) * query.pageSize + 1;
  const lastShown = Math.min(total, (query.page - 1) * query.pageSize + contacts.length);

  const handleCreated = useCallback((message: string) => {
    setDialogOpen(false);
    setSuccessMessage(message);
    router.refresh();
  }, [router]);

  const handleMutation = useCallback((message: string) => {
    setEditContact(null);
    setDeleteTarget(null);
    setOpenMenuId(null);
    setSuccessMessage(message);
    router.refresh();
  }, [router]);

  const addButton = (
    <Button onClick={() => { setSuccessMessage(null); setDialogOpen(true); }}>
      <Plus className="size-4" /> Add Contact
    </Button>
  );

  return (
    <>
      <PageHeader title="Contacts" description="Track every lead and relationship from one canonical contact record." action={addButton} />
      {successMessage && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status">{successMessage}</div>}
      {loadError ? (
        <div className="rounded-xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto size-8 text-rose-500" />
          <h2 className="mt-3 font-semibold">Unable to load contacts</h2>
          <p className="mt-1 text-sm text-slate-500">{loadError}</p>
          <Button variant="outline" className="mt-5" onClick={() => router.refresh()}>Try again</Button>
        </div>
      ) : workspaceTotal === 0 ? (
        <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center shadow-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><ContactRound className="size-7" /></div>
          <h2 className="mt-5 text-xl font-bold">No contacts yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Add your first contact to begin building customer relationships.</p>
          <div className="mt-6">{addButton}</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border bg-slate-50 pl-9 pr-3 text-sm focus:border-blue-500 focus:bg-white focus:outline-none" placeholder="Search contacts..." /></div>
            <div className="relative"><SlidersHorizontal className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><select value={query.status} onChange={(event) => go({ status: event.target.value as LeadStatus | "ALL", page: 1 })} className="h-10 min-w-48 appearance-none rounded-lg border bg-white pl-9 pr-8 text-sm font-medium text-slate-700 focus:border-blue-500 focus:outline-none"><option value="ALL">All lead statuses</option>{LEAD_STATUSES.map((leadStatus) => <option key={leadStatus} value={leadStatus}>{leadStatus.replaceAll("_", " ")}</option>)}</select></div>
            <span className="ml-auto text-xs font-medium text-slate-500">{isNavigating ? "Loading…" : `${total.toLocaleString("en-US")} of ${workspaceTotal.toLocaleString("en-US")} contacts`}</span>
          </div>
          <div className={`overflow-x-auto transition-opacity ${isNavigating ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[1260px] text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Contact</th><th className="px-4 py-3 font-semibold">Company & role</th><th className="px-4 py-3 font-semibold">Contact details</th><th className="px-4 py-3 font-semibold">Country</th><th className="px-4 py-3 font-semibold">Source</th><th className="px-4 py-3 font-semibold">Lead status</th><th className="px-4 py-3 text-right font-semibold">Score</th><th className="px-5 py-3 text-right font-semibold">Actions</th></tr></thead>
              <tbody className="divide-y">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="transition-colors hover:bg-slate-50/70">
                    <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{contact.initials}</div><Link href={`/contacts/${contact.id}`} className="text-sm font-semibold hover:text-blue-600 hover:underline">{contact.fullName}</Link></div></td>
                    <td className="px-4 py-4"><p className="text-sm font-medium">{contact.companyName ?? "—"}</p><p className="mt-0.5 text-xs text-slate-500">{contact.jobTitle ?? "—"}</p></td>
                    <td className="px-4 py-4"><p className="flex items-center gap-1.5 text-xs text-slate-600"><Mail className="size-3.5 text-slate-400" />{contact.email ?? "—"}</p><p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><Phone className="size-3.5 text-slate-400" />{contact.phone ?? "—"}</p></td>
                    <td className="px-4 py-4 text-sm text-slate-600">{contact.country ?? "—"}</td>
                    <td className="px-4 py-4 text-sm text-slate-600">{contact.source ?? "—"}</td>
                    <td className="px-4 py-4"><StatusBadge status={contact.leadStatus} /></td>
                    <td className="px-4 py-4"><div className="flex items-center justify-end gap-2"><div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${contact.leadScore}%` }} /></div><span className="w-6 text-right text-sm font-bold">{contact.leadScore}</span></div></td>
                    <td className="relative px-5 py-4 text-right">
                      <Button variant="ghost" size="icon" aria-label={`Actions for ${contact.fullName}`} onClick={() => setOpenMenuId((current) => current === contact.id ? null : contact.id)}><MoreHorizontal className="size-5" /></Button>
                      {openMenuId === contact.id && <div className="absolute right-5 top-12 z-20 w-36 rounded-lg border bg-white p-1 text-left shadow-lg"><button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => { setOpenMenuId(null); setEditContact(contact); }}><Pencil className="size-4" />Edit</button><button type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-rose-600 hover:bg-rose-50" onClick={() => { setOpenMenuId(null); setDeleteTarget(contact); }}><Trash2 className="size-4" />Delete</button></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total === 0 && <div className="px-5 py-14 text-center text-sm text-slate-500">No contacts match the current filters.</div>}
          {total > 0 && <div className="flex flex-col gap-3 border-t px-5 py-3 text-sm text-slate-600 sm:flex-row sm:items-center">
            <span className="tabular-nums">Showing {firstShown.toLocaleString("en-US")}–{lastShown.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
            <div className="flex items-center gap-2 sm:ml-auto">
              <Button variant="outline" size="sm" disabled={query.page <= 1 || isNavigating} onClick={() => go({ q: query.q, page: query.page - 1 })}><ChevronLeft className="size-4" />Previous</Button>
              <span className="tabular-nums text-xs text-slate-500">Page {query.page} / {pages}</span>
              <Button variant="outline" size="sm" disabled={query.page >= pages || isNavigating} onClick={() => go({ q: query.q, page: query.page + 1 })}>Next<ChevronRight className="size-4" /></Button>
            </div>
          </div>}
        </div>
      )}
      {dialogOpen && <AddContactDialog companies={companyOptions} onClose={() => setDialogOpen(false)} onCreated={handleCreated} />}
      {editContact && <EditContactDialog contact={editContact} companies={companyOptions} onClose={() => setEditContact(null)} onUpdated={handleMutation} />}
      {deleteTarget && <DeleteContactDialog contact={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={handleMutation} />}
    </>
  );
}
