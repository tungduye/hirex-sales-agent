import "server-only";

import type { Company, CompanyListItem, CompanyStatus } from "@/modules/crm/companies/types/company";

export interface CompanyRow {
  id: string;
  workspace_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  country: string | null;
  status: CompanyStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function mapCompanyRow(row: CompanyRow): Company {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    website: row.website,
    industry: row.industry,
    country: row.country,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCompanyListItem(company: Company): CompanyListItem {
  return {
    id: company.id,
    name: company.name,
    website: company.website,
    industry: company.industry,
    country: company.country,
    status: company.status,
    contactCount: 0,
    createdAt: company.createdAt,
  };
}
