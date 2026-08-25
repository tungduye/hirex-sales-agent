import type { LeadStatus } from "@/types/crm";

export interface DashboardMetrics {
  totalContacts: number | null;
  companies: number | null;
  newLeads: number | null;
  qualifiedLeads: number | null;
}

export interface DashboardRecentContact {
  id: string;
  fullName: string;
  initials: string;
  jobTitle: string | null;
  companyName: string | null;
  leadStatus: LeadStatus;
  createdAt: string;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  recentContacts: DashboardRecentContact[];
  metricsHaveError: boolean;
  recentContactsError: boolean;
}
