import { ContactsView } from "@/modules/crm/contacts/components/contacts-view";
import { listContacts } from "@/modules/crm/contacts/server/list-contacts";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const result = await listContacts(await searchParams);
  return (
    <ContactsView
      contacts={result.contacts}
      companyOptions={result.companyOptions}
      total={result.total}
      workspaceTotal={result.workspaceTotal}
      query={result.query}
      loadError={result.error}
    />
  );
}
