import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { mapContactRow, toContactListItem, type ContactRow } from "@/modules/crm/contacts/server/contact-mapper";
import { contactSearchPattern, normalizeContactListQuery, type ContactListQuery } from "@/modules/crm/contacts/core/contact-list-query";
import type { CompanyOption, ContactListItem } from "@/modules/crm/contacts/types/contact";

interface CompanyOptionRow {
  id: string;
  name: string;
}

export interface ListContactsResult {
  contacts: ContactListItem[];
  companyOptions: CompanyOption[];
  /** Matching contacts across the whole workspace, not just this page. */
  total: number;
  /** Contacts in the workspace before search/status filters. */
  workspaceTotal: number;
  query: ContactListQuery;
  error: string | null;
}

const CONTACT_COLUMNS = "id, workspace_id, company_id, full_name, job_title, email, phone, country, language, source, lead_status, lead_score, notes, created_at, updated_at";

// Supabase returns at most 1,000 rows per request, so the list is paged and searched on the
// server. Before this change the page loaded "everything" and silently stopped at 1,000.
export async function listContacts(raw: Record<string, string | string[] | undefined> = {}): Promise<ListContactsResult> {
  const query = normalizeContactListQuery(raw);
  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return { contacts: [], companyOptions: [], total: 0, workspaceTotal: 0, query, error: null };
  }

  const supabase = await createClient();
  let contactsQuery = supabase
    .from("contacts")
    .select(CONTACT_COLUMNS, { count: "exact" })
    .eq("workspace_id", account.workspaceId);
  const pattern = contactSearchPattern(query.q);
  if (pattern) {
    contactsQuery = contactsQuery.or(["full_name", "email", "phone", "job_title", "country", "source"].map((column) => `${column}.ilike.${pattern}`).join(","));
  }
  if (query.status !== "ALL") contactsQuery = contactsQuery.eq("lead_status", query.status);
  const from = (query.page - 1) * query.pageSize;

  const [contactsResult, companiesResult, totalResult] = await Promise.all([
    contactsQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + query.pageSize - 1),
    supabase.from("companies").select("id, name").eq("workspace_id", account.workspaceId).order("name", { ascending: true }),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId),
  ]);

  if (contactsResult.error || companiesResult.error) {
    return { contacts: [], companyOptions: [], total: 0, workspaceTotal: 0, query, error: "Contacts could not be loaded. Please try again." };
  }

  const companyOptions = companiesResult.data as CompanyOptionRow[];
  const companyNames = new Map(companyOptions.map((company) => [company.id, company.name]));
  const contacts = (contactsResult.data as ContactRow[])
    .map(mapContactRow)
    .map((contact) => toContactListItem(
      contact,
      contact.companyId ? companyNames.get(contact.companyId) ?? null : null,
    ));

  return {
    contacts,
    companyOptions,
    total: contactsResult.count ?? contacts.length,
    workspaceTotal: totalResult.count ?? contactsResult.count ?? contacts.length,
    query,
    error: null,
  };
}
