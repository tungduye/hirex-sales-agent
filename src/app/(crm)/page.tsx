import { HqView } from "@/modules/crm/dashboard/components/hq-view";
import { getHqData } from "@/modules/crm/dashboard/server/hq-data";

// Tổng quan = HireX HQ: live numbers from Suối Nguồn, Lịch hẹn, Chiến dịch, AI Recruiter and CV, each part shown
// only to members with the matching right. ?tang=<phòng> (rec, sale, am, …) highlights one bộ phận. (Bản tin hôm nay stays in Trợ lý.)
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ tang?: string }> }) {
  const { tang } = await searchParams;
  const data = await getHqData(tang);
  if (!data) return null;
  return <HqView data={data} />;
}
