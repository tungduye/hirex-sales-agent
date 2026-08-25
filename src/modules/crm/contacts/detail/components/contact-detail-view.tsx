import Link from "next/link";
import { ArrowLeft, Building2, Mail, Phone, UserRound } from "lucide-react";
import { ContactChannelsSection } from "@/modules/crm/contact-channels/components/contact-channels-section";
import type { ContactChannel } from "@/modules/crm/contact-channels/types/contact-channel";
import { StatusBadge } from "@/modules/crm/components/status-badge";
import type { ContactDetail } from "@/modules/crm/contacts/detail/types/contact-detail";

interface Props {
  contact: ContactDetail;
  channels: ContactChannel[];
  channelsError: string | null;
}

export function ContactDetailView({ contact, channels, channelsError }: Props) {
  return (
    <>
      <Link href="/contacts" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><ArrowLeft className="size-4" /> Back to Contacts</Link>
      <header className="mb-6 flex flex-col gap-4 rounded-xl border bg-white p-5 shadow-sm sm:flex-row sm:items-center">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">{contact.initials}</div>
        <div className="min-w-0 flex-1"><h1 className="truncate text-2xl font-bold tracking-tight text-slate-950">{contact.fullName}</h1><p className="mt-1 text-sm text-slate-500">{[contact.jobTitle, contact.companyName].filter(Boolean).join(" · ") || "Contact record"}</p></div>
        <StatusBadge status={contact.leadStatus} />
      </header>
      <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4"><h2 className="font-semibold">Contact Information</h2><p className="mt-0.5 text-xs text-slate-500">Core CRM fields for this contact.</p></div>
          <dl className="grid gap-x-6 gap-y-5 p-5 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <InformationItem icon={UserRound} label="Full Name" value={contact.fullName} />
            <InformationItem icon={Building2} label="Company" value={contact.companyName} />
            <InformationItem label="Job Title" value={contact.jobTitle} />
            <InformationItem icon={Mail} label="Email" value={contact.email} />
            <InformationItem icon={Phone} label="Phone" value={contact.phone} />
            <InformationItem label="Country" value={contact.country} />
            <InformationItem label="Language" value={contact.language} />
            <InformationItem label="Source" value={contact.source} />
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lead Status</dt><dd className="mt-2"><StatusBadge status={contact.leadStatus} /></dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Lead Score</dt><dd className="mt-2 flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${contact.leadScore}%` }} /></div><span className="text-sm font-bold text-slate-900">{contact.leadScore}</span></dd></div>
          </dl>
        </section>
        <ContactChannelsSection contactId={contact.id} channels={channels} loadError={channelsError} />
      </div>
    </>
  );
}

function InformationItem({ icon: Icon, label, value }: { icon?: typeof UserRound; label: string; value: string | null }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1.5 flex items-center gap-2 break-words text-sm font-medium text-slate-800">{Icon && <Icon className="size-4 shrink-0 text-slate-400" />}{value ?? "—"}</dd></div>;
}
