import { Suspense } from "react";
import { HqView } from "@/modules/crm/dashboard/components/hq-view";
import { getHqData } from "@/modules/crm/dashboard/server/hq-data";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { DailyBriefSkeleton } from "@/modules/assistant/components/daily-brief-card";
import { DailyBriefSection } from "@/modules/assistant/components/daily-brief-section";

// Tổng quan = HireX HQ (mức 1): live numbers from Suối Nguồn, Lịch hẹn, Chiến dịch, AI Recruiter and CV,
// each part shown only to members with the matching right. ?tang=rec|sale narrows to one floor.
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tang?: string }> }) {
  const [{ tang }, account] = await Promise.all([searchParams, getAccountContext()]);
  const data = await getHqData(tang);
  if (!data) return null;
  // The brief streams in after the page shows; its first build of the day can take a few seconds.
  const brief = account?.permissions.includes("dashboard.view")
    ? <Suspense fallback={<DailyBriefSkeleton />}><DailyBriefSection /></Suspense>
    : null;
  return <HqView data={data} brief={brief} />;
}
