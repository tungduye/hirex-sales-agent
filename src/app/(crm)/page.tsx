import { Suspense } from "react";
import { DashboardView } from "@/modules/crm/dashboard/components/dashboard-view";
import { getDashboardData } from "@/modules/crm/dashboard/server/get-dashboard-data";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { DailyBriefSkeleton } from "@/modules/assistant/components/daily-brief-card";
import { DailyBriefSection } from "@/modules/assistant/components/daily-brief-section";

export default async function DashboardPage() {
  const [data, account] = await Promise.all([
    getDashboardData(),
    getAccountContext(),
  ]);

  // The brief streams in after the page shows; its first build of the day can take a few seconds.
  const brief = account?.permissions.includes("dashboard.view")
    ? <Suspense fallback={<DailyBriefSkeleton />}><DailyBriefSection /></Suspense>
    : null;
  return <DashboardView fullName={account?.fullName ?? null} data={data} brief={brief} />;
}
