import { CompaniesView } from "@/modules/crm/companies/components/companies-view";
import { listCompanies } from "@/modules/crm/companies/server/list-companies";

export default async function CompaniesPage() {
  const result = await listCompanies();
  return <CompaniesView companies={result.companies} loadError={result.error} />;
}
