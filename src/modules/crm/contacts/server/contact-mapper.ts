import "server-only";

import type { Contact, ContactListItem } from "@/modules/crm/contacts/types/contact";
import type { LeadStatus } from "@/types/crm";

export interface ContactRow {
  id: string;
  workspace_id: string;
  company_id: string | null;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  language: string | null;
  source: string | null;
  lead_status: LeadStatus;
  lead_score: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function mapContactRow(row: ContactRow): Contact {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    companyId: row.company_id,
    fullName: row.full_name,
    jobTitle: row.job_title,
    email: row.email,
    phone: row.phone,
    country: row.country,
    language: row.language,
    source: row.source,
    leadStatus: row.lead_status,
    leadScore: row.lead_score,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toContactListItem(
  contact: Contact,
  companyName: string | null,
): ContactListItem {
  return {
    id: contact.id,
    fullName: contact.fullName,
    initials: getInitials(contact.fullName),
    companyName,
    jobTitle: contact.jobTitle,
    email: contact.email,
    phone: contact.phone,
    country: contact.country,
    source: contact.source,
    leadStatus: contact.leadStatus,
    leadScore: contact.leadScore,
    createdAt: contact.createdAt,
  };
}

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}
