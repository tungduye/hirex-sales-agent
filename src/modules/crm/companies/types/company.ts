export const COMPANY_STATUSES = ["PROSPECT", "ACTIVE", "INACTIVE"] as const;

export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export interface Company {
  id: string;
  workspaceId: string;
  name: string;
  website: string | null;
  industry: string | null;
  country: string | null;
  status: CompanyStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyListItem {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  country: string | null;
  status: CompanyStatus;
  contactCount: number;
  createdAt: string;
}
