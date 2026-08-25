import { notFound } from "next/navigation";
import { listContactChannels } from "@/modules/crm/contact-channels/server/list-contact-channels";
import { ContactDetailView } from "@/modules/crm/contacts/detail/components/contact-detail-view";
import { getContactDetail } from "@/modules/crm/contacts/detail/server/get-contact-detail";

export default async function ContactDetailPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  const detailResult = await getContactDetail(contactId);

  if (detailResult.status === "not_found") notFound();
  if (detailResult.status === "error") {
    return <div className="rounded-xl border border-rose-200 bg-white p-8 text-center shadow-sm"><h1 className="text-lg font-bold">Unable to load contact</h1><p className="mt-2 text-sm text-slate-500">{detailResult.message}</p></div>;
  }

  const channelsResult = await listContactChannels(contactId);
  return <ContactDetailView contact={detailResult.contact} channels={channelsResult.channels} channelsError={channelsResult.error} />;
}
