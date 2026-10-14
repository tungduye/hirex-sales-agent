import { DailyBriefCard } from "@/modules/assistant/components/daily-brief-card";
import { getDailyBrief } from "@/modules/assistant/server/daily-brief";

/** Server part of the dashboard brief: loads (or builds) today's brief, then hands it to the card. */
export async function DailyBriefSection() {
  const result = await getDailyBrief({ refresh: false }).catch(() => null);
  return <DailyBriefCard initial={result?.ok ? result.brief : null} />;
}
