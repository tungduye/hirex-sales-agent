import { DashboardView } from "@/modules/crm/dashboard/components/dashboard-view";
import { getDashboardData } from "@/modules/crm/dashboard/server/get-dashboard-data";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export default async function DashboardPage() {
  const [data, account] = await Promise.all([
    getDashboardData(),
    getAccountContext(),
  ]);

  return <DashboardView fullName={account?.fullName ?? null} data={data} />;
}
