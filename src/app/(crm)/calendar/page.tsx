import { isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { CalendarView } from "@/modules/calendar/components/calendar-view";
import { isoWeekday, parseVnDay, vnDay } from "@/modules/calendar/core/calendar";
import { getMyReminderDefaults, listOccurrences, type CalendarScope } from "@/modules/calendar/server/calendar-data";

export const metadata = { title: "Lịch hẹn" };
const DAY = 86_400_000;
const VN = 7 * 3_600_000;
const todayNumber = () => vnDay(Date.now());

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ tuan?: string; pham_vi?: string }> }) {
  const params = await searchParams;
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const context = { workspaceId: account.workspaceId, userId: account.userId, permissions: account.permissions, isAdmin: await isWorkspaceAdmin() };
  const picked = params.tuan ? parseVnDay(params.tuan) : null;
  const today = todayNumber();
  const day = picked ?? today;
  const monday = day - (isoWeekday(day) - 1);
  const scope: CalendarScope = params.pham_vi === "TEAM" || params.pham_vi === "ALL" ? params.pham_vi : "MINE";
  const from = monday * DAY - VN;
  const [result, defaults] = await Promise.all([listOccurrences(context, { from, to: from + 7 * DAY, scope }), getMyReminderDefaults(context)]);
  return <CalendarView
    monday={monday} today={today} scope={result.scope} seesAll={result.viewer.seesAll} hasTeam={result.viewer.team.size > 1}
    occurrences={result.occurrences} members={result.members.map((member) => ({ id: member.id, name: member.name }))} userId={account.userId} defaults={defaults}/>;
}
