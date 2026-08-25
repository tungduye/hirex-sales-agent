import "server-only";

import { createClient } from "@/lib/supabase/server";
import { contactIdSchema } from "@/modules/crm/contact-channels/schemas/contact-channel-schema";
import type { GetContactDetailResult } from "@/modules/crm/contacts/detail/types/contact-detail";
import { mapContactRow, type ContactRow } from "@/modules/crm/contacts/server/contact-mapper";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

interface ContactDetailRow extends ContactRow {
  companies: { name: string } | { name: string }[] | null;
}

export async function getContactDetail(contactId: string): Promise<GetContactDetailResult> {
  const parsedContactId = contactIdSchema.safeParse(contactId);
  if (!parsedContactId.success) return { status: "not_found" };

  const account = await getAccountContext();
  if (!account?.workspaceId || !account.configurationComplete) return { status: "not_found" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, workspace_id, company_id, full_name, job_title, email, phone, country, language, source, lead_status, lead_score, notes, created_at, updated_at, companies(name)")
    .eq("id", parsedContactId.data)
    .eq("workspace_id", account.workspaceId)
    .maybeSingle();

  if (error) return { status: "error", message: "Contact details could not be loaded. Please try again." };
  if (!data) return { status: "not_found" };

  const row = data as ContactDetailRow;
  const contact = mapContactRow(row);
  const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;

  return {
    status: "ok",
    contact: {
      ...contact,
      companyName: company?.name ?? null,
      initials: getInitials(contact.fullName),
    },
  };
}

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}
