import type { LeadStatus } from "@/types/crm";

export interface Contact {
  id: string;
  workspaceId: string;
  companyId: string | null;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  language: string | null;
  source: string | null;
  leadStatus: LeadStatus;
  leadScore: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactListItem {
  id: string;
  fullName: string;
  initials: string;
  companyName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  source: string | null;
  leadStatus: LeadStatus;
  leadScore: number;
  createdAt: string;
}

export interface CompanyOption {
  id: string;
  name: string;
}
