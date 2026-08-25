import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { mapContactRow, toContactListItem, type ContactRow } from "@/modules/crm/contacts/server/contact-mapper";
import type { CompanyOption, ContactListItem } from "@/modules/crm/contacts/types/contact";

interface CompanyOptionRow {
  id: string;
  name: string;
}

interface ListContactsResult {
  contacts: ContactListItem[];
  companyOptions: CompanyOption[];
  error: string | null;
}

export async function listContacts(): Promise<ListContactsResult> {
  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return { contacts: [], companyOptions: [], error: null };
  }

  const supabase = await createClient();
  const [contactsResult, companiesResult] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, workspace_id, company_id, full_name, job_title, email, phone, country, language, source, lead_status, lead_score, notes, created_at, updated_at")
      .eq("workspace_id", account.workspaceId)
      .order("created_at", { ascending: false }),
    supabase
      .from("companies")
      .select("id, name")
      .eq("workspace_id", account.workspaceId)
      .order("name", { ascending: true }),
  ]);

  if (contactsResult.error || companiesResult.error) {
    return {
      contacts: [],
      companyOptions: [],
      error: "Contacts could not be loaded. Please try again.",
    };
  }

  const companyOptions = companiesResult.data as CompanyOptionRow[];
  const companyNames = new Map(companyOptions.map((company) => [company.id, company.name]));
  const contacts = (contactsResult.data as ContactRow[])
    .map(mapContactRow)
    .map((contact) => toContactListItem(
      contact,
      contact.companyId ? companyNames.get(contact.companyId) ?? null : null,
    ));

  return { contacts, companyOptions, error: null };
}
