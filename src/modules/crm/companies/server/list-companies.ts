import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { mapCompanyRow, toCompanyListItem, type CompanyRow } from "@/modules/crm/companies/server/company-mapper";
import type { CompanyListItem } from "@/modules/crm/companies/types/company";

interface ListCompaniesResult {
  companies: CompanyListItem[];
  error: string | null;
}

export async function listCompanies(): Promise<ListCompaniesResult> {
  const account = await getAccountContext();

  if (!account?.workspaceId || !account.configurationComplete) {
    return { companies: [], error: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id, workspace_id, name, website, industry, country, status, notes, created_at, updated_at")
    .eq("workspace_id", account.workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    return {
      companies: [],
      error: "Companies could not be loaded. Please try again.",
    };
  }

  return {
    companies: (data as CompanyRow[]).map(mapCompanyRow).map(toCompanyListItem),
    error: null,
  };
}
