import { ContactsView } from "@/modules/crm/contacts/components/contacts-view";
import { listContacts } from "@/modules/crm/contacts/server/list-contacts";

export default async function ContactsPage() {
  const result = await listContacts();
  return (
    <ContactsView
      contacts={result.contacts}
      companyOptions={result.companyOptions}
      loadError={result.error}
    />
  );
}
