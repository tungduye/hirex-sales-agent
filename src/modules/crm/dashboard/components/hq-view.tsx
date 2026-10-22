import type { HqData } from "@/modules/crm/dashboard/server/hq-data";
import { HqAutoRefresh } from "@/modules/crm/dashboard/components/hq-live";
import { HqStage } from "@/modules/crm/dashboard/components/hq-stage";

// HireX HQ (Tổng quan): the office map fills the screen; numbers, feed and team open on top of it (hq-stage.tsx).
// The page re-reads its data every minute without reloading, so what is open stays open.
export function HqView({ data }: { data: HqData }) {
  return (
    <>
      <HqAutoRefresh />
      <HqStage data={data} />
    </>
  );
}
