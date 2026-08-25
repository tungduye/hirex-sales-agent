import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import type {
  DashboardData,
  DashboardRecentContact,
} from "@/modules/crm/dashboard/types/dashboard";
import type { LeadStatus } from "@/types/crm";

interface RecentContactRow {
  id: string;
  full_name: string;
  job_title: string | null;
  lead_status: LeadStatus;
  created_at: string;
  companies: { name: string } | { name: string }[] | null;
}

const emptyDashboardData: DashboardData = {
  metrics: {
    totalContacts: null,
    companies: null,
    newLeads: null,
    qualifiedLeads: null,
  },
  recentContacts: [],
  metricsHaveError: true,
  recentContactsError: true,
};

export async function getDashboardData(): Promise<DashboardData> {
  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return emptyDashboardData;
  }

  const supabase = await createClient();
  const workspaceId = account.workspaceId;
  const [totalContacts, companies, newLeads, qualifiedLeads, recentContacts] =
    await Promise.all([
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      supabase
        .from("companies")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("lead_status", "NEW"),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("lead_status", "QUALIFIED"),
      supabase
        .from("contacts")
        .select("id, full_name, job_title, lead_status, created_at, companies(name)")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const metricResults = [totalContacts, companies, newLeads, qualifiedLeads];

  return {
    metrics: {
      totalContacts: totalContacts.error ? null : totalContacts.count,
      companies: companies.error ? null : companies.count,
      newLeads: newLeads.error ? null : newLeads.count,
      qualifiedLeads: qualifiedLeads.error ? null : qualifiedLeads.count,
    },
    recentContacts: recentContacts.error
      ? []
      : (recentContacts.data as RecentContactRow[]).map(mapRecentContact),
    metricsHaveError: metricResults.some((result) => Boolean(result.error)),
    recentContactsError: Boolean(recentContacts.error),
  };
}

function mapRecentContact(row: RecentContactRow): DashboardRecentContact {
  const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;

  return {
    id: row.id,
    fullName: row.full_name,
    initials: getInitials(row.full_name),
    jobTitle: row.job_title,
    companyName: company?.name ?? null,
    leadStatus: row.lead_status,
    createdAt: row.created_at,
  };
}

function getInitials(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}
