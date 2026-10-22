import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds, isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { listOccurrences } from "@/modules/calendar/server/calendar-data";
import { listChannelCampaigns } from "@/modules/channels/server/get-channel-campaign-data";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { teamOf } from "@/modules/inbox/core/inbox-scope";

// HireX HQ (màn Tổng quan, mức 1): the live numbers of the company in one place. Every part follows the
// member's rights: no inbox numbers without "Suối Nguồn · Xem", no CVs without "CV · Xem", and the team list
// shows everyone only to admins / people who may view roles (otherwise the member and the people they manage).

export type HqFloor = "ALL" | "REC" | "SALE";
export interface HqKpi { key: string; label: string; value: number | null; note: string; href: string; tone: "alert" | "info" | "meet" | "plain" }
export interface HqRoom { key: string; name: string; meta: string; href: string; tone: "cyan" | "red" | "violet" | "green" }
export interface HqFeedItem { kind: string; tone: "info" | "alert" | "meet" | "plain"; text: string; at: string; href: string | null }
export interface HqMember { id: string; name: string; initials: string; department: string | null; doing: string; status: string; tone: "busy" | "alert" | "meet" | "idle"; waiting: number }
export interface HqData {
  fullName: string | null; floor: HqFloor; liveNicks: number | null; nextMeetingAt: string | null; nextMeetingTitle: string | null;
  kpis: HqKpi[]; rooms: HqRoom[]; feed: HqFeedItem[]; team: HqMember[]; canSeeTeam: boolean;
}

type Row = Record<string, unknown>;
type Summary = { a: string; o: string | null; g: boolean; w: boolean; i: boolean; u: boolean; t: string[]; c: number };
const VN_OFFSET = 7 * 3_600_000;
const startOfVnDay = (now: number) => new Date(Math.floor((now + VN_OFFSET) / 86_400_000) * 86_400_000 - VN_OFFSET);
const fold = (value: string | null | undefined) => (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const initials = (name: string) => { const words = name.split(/\s+/u).filter(Boolean); return (words.length > 1 ? words.slice(-2) : words).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?"; };
const time = (iso: string) => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const floorMatches = (floor: HqFloor, department: string | null | undefined) => floor === "ALL" || (floor === "REC" ? /\brec\b/u.test(fold(department)) : /\bsale\b/u.test(fold(department)));

export async function getHqData(floorParam: string | undefined): Promise<HqData | null> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const floor: HqFloor = floorParam === "rec" ? "REC" : floorParam === "sale" ? "SALE" : "ALL";
  const can = (key: string) => account.permissions.includes(key);
  const db = createPrivilegedClient();
  const supabase = await createClient();
  const now = Date.now(), dayStart = startOfVnDay(now), since30 = new Date(now - 30 * 86_400_000).toISOString();
  const [isAdmin, accessible, { data: profileRows }] = await Promise.all([
    isWorkspaceAdmin(), getAccessibleChannelAccountIds(),
    db.from("profiles").select("id,full_name,department,manager_id").eq("workspace_id", account.workspaceId),
  ]);
  const profiles = ((profileRows ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.full_name ?? "Thành viên"), department: typeof row.department === "string" ? row.department : null, managerId: typeof row.manager_id === "string" ? row.manager_id : null }));
  const departmentOf = new Map(profiles.map((person) => [person.id, person.department]));
  const seesAll = isAdmin || can("roles.view");
  const visiblePeople = seesAll ? new Set(profiles.map((person) => person.id)) : teamOf(account.userId, profiles.map((person) => ({ id: person.id, managerId: person.managerId })));

  const inbox = (async () => {
    if (!can("inbox.view")) return null;
    let query = db.from("channel_accounts").select("id,status,primary_profile_id,channel_type").eq("workspace_id", account.workspaceId).is("deleted_at", null);
    if (accessible) query = query.in("id", accessible.length ? accessible : ["00000000-0000-0000-0000-000000000000"]);
    const { data: accounts } = await query;
    const nicks = (accounts ?? []) as Row[];
    if (!nicks.length) return null;
    const ownerOfNick = new Map(nicks.map((row) => [String(row.id), typeof row.primary_profile_id === "string" ? row.primary_profile_id : null]));
    const { data } = await supabase.rpc("inbox_conversation_summary", { p_account_ids: nicks.map((row) => String(row.id)), p_channel_types: null, p_since: since30 });
    const rows = (Array.isArray(data) ? data : []) as Summary[];
    const byOwner = new Map<string, number>();
    let waiting = 0, important = 0, tagged = 0;
    for (const row of rows) {
      const owner = row.o ?? ownerOfNick.get(row.a) ?? null;
      if (!floorMatches(floor, owner ? departmentOf.get(owner) : null)) continue;
      const count = Number(row.c) || 0;
      if (row.w) { waiting += count; if (row.g) tagged += count; if (owner) byOwner.set(owner, (byOwner.get(owner) ?? 0) + count); }
      if (row.i) important += count;
    }
    return { waiting, important, tagged, byOwner, liveNicks: nicks.filter((row) => row.channel_type === "ZALO" && row.status === "CONNECTED").length };
  })();

  const calendar = (async () => {
    const result = await listOccurrences({ workspaceId: account.workspaceId!, userId: account.userId, permissions: account.permissions, isAdmin },
      { from: dayStart.getTime(), to: dayStart.getTime() + 86_400_000, scope: seesAll ? "ALL" : "TEAM" }).catch(() => null);
    const today = result?.occurrences ?? [];
    const inMeeting = new Map<string, string>();
    for (const item of today) if (item.start <= now && now < item.end) for (const id of [item.createdBy, ...item.attendees.filter((a) => !a.declined).map((a) => a.id)]) inMeeting.set(id, item.title);
    const next = today.find((item) => item.start > now) ?? null;
    return { today: today.length, interviews: today.filter((item) => item.kind === "PHONG_VAN").length, inMeeting, next };
  })();

  const cvs = (async () => {
    if (!can("cvs.view") && !can("cvs.view_all")) return null;
    const since = (from: Date) => supabase.from("human_cvs").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).gte("human_created_at", from.toISOString());
    const [{ count: today }, { count: twoDays }] = await Promise.all([since(dayStart), since(new Date(dayStart.getTime() - 86_400_000))]);
    return { today: today ?? 0, yesterday: Math.max(0, (twoDays ?? 0) - (today ?? 0)) };
  })();

  const campaigns = (async () => {
    if (!can("campaigns.view")) return null;
    const [list, { count: repliesToday }] = await Promise.all([
      listChannelCampaigns().catch(() => []),
      supabase.from("channel_campaign_recipients").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("status", "REPLIED").gte("replied_at", dayStart.toISOString()),
    ]);
    return { running: list.filter((row) => row.status === "RUNNING").length, sent: list.reduce((sum, row) => sum + row.sent, 0), replies: list.reduce((sum, row) => sum + row.replies, 0), repliesToday: repliesToday ?? 0 };
  })();

  const broadcasts = (async () => {
    if (!can("broadcasts.view") && !isAdmin) return null;
    const { count } = await db.from("zalo_broadcasts").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("status", "RUNNING");
    return count ?? 0;
  })();

  const aiRecruiter = (async () => {
    if (!isAdmin) return null;
    const { count } = await db.from("ai_recruiter_conversation_states").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId)
      .in("status", ["COLLECTING_PROFILE", "PROFILE_COMPLETE", "OFFERING_JOB", "DISCUSSING_PROCESS"]).gte("updated_at", new Date(now - 86_400_000).toISOString());
    return count ?? 0;
  })();

  // Who is replying right now: a message they sent in the last 15 minutes.
  const typing = (async () => {
    const { data } = await db.from("channel_outbound_actions").select("approved_by").eq("workspace_id", account.workspaceId).eq("dispatch_source", "HUMAN_MANUAL").not("approved_by", "is", null)
      .gte("approved_at", new Date(now - 15 * 60_000).toISOString()).limit(500);
    return new Set(((data ?? []) as Row[]).map((row) => String(row.approved_by)));
  })();

  const feed = (async () => {
    const items: Array<HqFeedItem & { sort: number }> = [];
    const jobs: Array<Promise<void>> = [];
    if (can("inbox.view")) jobs.push((async () => {
      let query = supabase.from("omnichannel_conversations").select("id,subject,metadata,mention_pending_at").eq("workspace_id", account.workspaceId).not("mention_pending_at", "is", null).order("mention_pending_at", { ascending: false }).limit(3);
      if (accessible) query = query.in("channel_account_id", accessible.length ? accessible : ["00000000-0000-0000-0000-000000000000"]);
      const { data } = await query;
      for (const row of (data ?? []) as Row[]) {
        const meta = (row.metadata ?? {}) as Row;
        const name = String(meta.groupName ?? meta.conversationDisplayName ?? row.subject ?? "Nhóm Zalo");
        items.push({ kind: "@ tag", tone: "alert", text: `Nhóm “${name}” tag nick mình, chưa trả lời`, at: time(String(row.mention_pending_at)), href: `/inbox/all/${row.id}`, sort: Date.parse(String(row.mention_pending_at)) });
      }
    })());
    if (can("campaigns.view")) jobs.push((async () => {
      const { data } = await supabase.from("channel_campaign_recipients").select("replied_at,channel_campaigns(name),contacts(full_name)").eq("workspace_id", account.workspaceId).eq("status", "REPLIED").not("replied_at", "is", null).order("replied_at", { ascending: false }).limit(3);
      for (const row of (data ?? []) as Row[]) {
        const campaign = (Array.isArray(row.channel_campaigns) ? row.channel_campaigns[0] : row.channel_campaigns) as Row | null;
        const contact = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as Row | null;
        items.push({ kind: "Chiến dịch", tone: "meet", text: `${String(contact?.full_name ?? "Ứng viên")} phản hồi “${String(campaign?.name ?? "chiến dịch")}”`, at: time(String(row.replied_at)), href: "/campaigns/omnichannel", sort: Date.parse(String(row.replied_at)) });
      }
    })());
    jobs.push((async () => {
      let query = db.from("assistant_actions").select("kind,status,created_at,user_id,preview").eq("workspace_id", account.workspaceId).order("created_at", { ascending: false }).limit(3);
      if (!isAdmin) query = query.eq("user_id", account.userId);
      const { data } = await query;
      for (const row of (data ?? []) as Row[]) {
        const title = String(((row.preview ?? {}) as Row).title ?? row.kind);
        const state = row.status === "EXECUTED" ? "đã làm" : row.status === "CANCELLED" ? "đã huỷ" : row.status === "PROPOSED" ? "chờ xác nhận" : String(row.status).toLowerCase();
        items.push({ kind: "Soda", tone: "info", text: `${title} (${state})`, at: time(String(row.created_at)), href: "/assistant", sort: Date.parse(String(row.created_at)) });
      }
    })());
    if (isAdmin) jobs.push((async () => {
      const { data } = await db.from("ai_recruiter_runs").select("status,created_at,omnichannel_conversations(metadata)").eq("workspace_id", account.workspaceId).in("status", ["SENT", "DRAFT_READY"]).order("created_at", { ascending: false }).limit(3);
      for (const row of (data ?? []) as Row[]) {
        const conversation = (Array.isArray(row.omnichannel_conversations) ? row.omnichannel_conversations[0] : row.omnichannel_conversations) as Row | null;
        const meta = (conversation?.metadata ?? {}) as Row;
        const name = String(meta.participantDisplayName ?? meta.conversationDisplayName ?? "ứng viên");
        items.push({ kind: "AI Rec", tone: "info", text: row.status === "SENT" ? `Đã trả lời ${name}` : `Soạn nháp trả lời ${name}`, at: time(String(row.created_at)), href: "/settings/ai-recruiter", sort: Date.parse(String(row.created_at)) });
      }
    })());
    await Promise.all(jobs.map((job) => job.catch(() => undefined)));
    return items.sort((a, b) => b.sort - a.sort).slice(0, 8).map((item): HqFeedItem => ({ kind: item.kind, tone: item.tone, text: item.text, at: item.at, href: item.href }));
  })();

  const [inboxData, calendarData, cvToday, campaignData, broadcastRunning, aiActive, typingNow, feedItems] = await Promise.all([inbox, calendar, cvs, campaigns, broadcasts, aiRecruiter, typing, feed]);

  const team: HqMember[] = profiles
    .filter((person) => visiblePeople.has(person.id) && floorMatches(floor, person.department))
    .map((person) => {
      const waiting = inboxData?.byOwner.get(person.id) ?? 0;
      const meeting = calendarData.inMeeting.get(person.id);
      const replying = typingNow.has(person.id);
      const status = meeting ? { status: "Đang họp", tone: "meet" as const } : waiting >= 100 ? { status: "Cần xem", tone: "alert" as const } : replying ? { status: "Đang nhắn", tone: "busy" as const } : { status: "—", tone: "idle" as const };
      const doing = [meeting ? `Họp: ${meeting}` : replying ? "Đang trả lời tin" : null, inboxData ? `${waiting.toLocaleString("vi-VN")} chưa trả lời` : null].filter(Boolean).join(" · ") || "Chưa có hoạt động";
      return { id: person.id, name: person.name, initials: initials(person.name), department: person.department, doing, waiting, ...status };
    })
    .sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name, "vi"))
    .slice(0, 30);

  const kpis: HqKpi[] = [
    { key: "waiting", label: "Chưa trả lời", value: inboxData?.waiting ?? null, note: inboxData ? `${inboxData.tagged.toLocaleString("vi-VN")} nhóm tag mình · 30 ngày` : "Cần quyền Suối Nguồn", href: "/inbox/all?view=waiting", tone: "alert" },
    { key: "cv", label: "CV mới hôm nay", value: cvToday?.today ?? null, note: cvToday === null ? "Cần quyền CV" : `Hôm qua ${cvToday.yesterday.toLocaleString("vi-VN")} · Human cập nhật mỗi 6 giờ`, href: "/cvs", tone: "info" },
    { key: "meet", label: "Lịch hẹn hôm nay", value: calendarData.today, note: `${calendarData.interviews} phỏng vấn`, href: "/calendar", tone: "meet" },
    { key: "replies", label: "Phản hồi chiến dịch Zalo", value: campaignData?.replies ?? null, note: campaignData ? `+${campaignData.repliesToday} hôm nay · ${campaignData.sent.toLocaleString("vi-VN")} tin gửi` : "Cần quyền Chiến dịch", href: "/campaigns/omnichannel", tone: "plain" },
  ];
  const peopleIn = (pattern: RegExp) => profiles.filter((person) => pattern.test(fold(person.department))).length;
  const rooms: HqRoom[] = [
    { key: "soda", name: "Lễ tân · Soda", meta: "Bản tin hôm nay", href: "/assistant", tone: "cyan" },
    { key: "inbox", name: "Trạm tin nhắn", meta: inboxData ? `${inboxData.waiting.toLocaleString("vi-VN")} chờ` : "—", href: "/inbox/all?view=waiting", tone: "red" },
    { key: "tower", name: "Tháp phát sóng", meta: campaignData || broadcastRunning !== null ? `${(campaignData?.running ?? 0) + (broadcastRunning ?? 0)} đang chạy` : "—", href: "/campaigns/omnichannel", tone: "violet" },
    { key: "rec", name: "Phòng Rec", meta: `${peopleIn(/\brec\b/u)} người`, href: "/?tang=rec", tone: "cyan" },
    { key: "sale", name: "Phòng Sale", meta: `${peopleIn(/\bsale\b/u)} người`, href: "/?tang=sale", tone: "violet" },
    { key: "meeting", name: "Phòng họp", meta: `${calendarData.today} lịch hôm nay`, href: "/calendar", tone: "violet" },
    { key: "ai", name: "Bàn AI Recruiter", meta: aiActive === null ? "—" : `${aiActive} UV đang tư vấn`, href: "/settings/ai-recruiter", tone: "green" },
    { key: "cv", name: "Kho CV", meta: cvToday === null ? "—" : `${cvToday.today} mới hôm nay`, href: "/cvs", tone: "cyan" },
  ];
  return {
    fullName: account.fullName ?? null, floor, liveNicks: inboxData?.liveNicks ?? null,
    nextMeetingAt: calendarData.next ? new Date(calendarData.next.start).toISOString() : null, nextMeetingTitle: calendarData.next?.title ?? null,
    kpis, rooms, feed: feedItems, team, canSeeTeam: seesAll || visiblePeople.size > 1,
  };
}
