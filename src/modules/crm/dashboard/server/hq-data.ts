import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds, isWorkspaceAdmin } from "@/modules/access/server/access-control";
import { listOccurrences } from "@/modules/calendar/server/calendar-data";
import { listChannelCampaigns } from "@/modules/channels/server/get-channel-campaign-data";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { teamOf } from "@/modules/inbox/core/inbox-scope";

// HireX HQ (màn Tổng quan): the live numbers of the company in one place, counted the same way as each screen:
//   Chưa trả lời  = Suối Nguồn's "Chưa trả lời" tab over every nick the member may see (scope "Tất cả", Soda's nick
//                   left out, last 30 days) — per member = the Suối Nguồn "Người phụ trách" filter (main user of the nick);
//   Zalo Mkt      = the Zalo Marketing list (same campaigns, same sent / replies);
//   CV            = the CV screen (active CVs the member may see);
//   Lịch hẹn      = Lịch hẹn with "Công ty" (or "Team") scope.
// Every part follows the member's rights; the team list shows everyone only to admins / people who may view roles.

export type HqFloor = "ALL" | "REC" | "SALE";
export interface HqKpi { key: string; room: string; label: string; value: number | null; note: string; href: string; tone: "alert" | "info" | "meet" | "plain" }
export interface HqRoom { key: string; name: string; meta: string; href: string; tone: "cyan" | "red" | "violet" | "green" }
export interface HqFeedItem { kind: string; tone: "info" | "alert" | "meet" | "plain"; text: string; at: string; href: string | null }
export interface HqMember { id: string; name: string; initials: string; department: string | null; doing: string; status: string; tone: "busy" | "alert" | "meet" | "idle"; waiting: number; avatarUrl: string | null; seat: "REC" | "SALE" | "MEET" | null }
/** The numbers drawn on the office map (null = the member may not see that part). */
export interface HqStats { waiting: number | null; tagged: number | null; sent: number | null; replies: number | null; running: number | null; aiActive: number | null; cvToday: number | null; meetingsToday: number }
/** What a room shows when it is picked on the map (a summary of its screen). */
export interface HqDetails {
  inbox: { waiting: number; personal: number; tagged: number; important: number; unowned: number; capped: boolean; people: Array<{ id: string; name: string; waiting: number }> } | null;
  zalo: { running: number; sent: number; replies: number; repliesToday: number; campaigns: Array<{ id: string; name: string; status: string; sent: number; replies: number; owner: string | null }> } | null;
  broadcasts: { running: number; recent: Array<{ id: string; name: string; status: string; at: string }> } | null;
  cv: { today: number; yesterday: number; total: number; lastSync: string | null } | null;
  calendar: { scope: string; events: Array<{ id: string; time: string; title: string; kind: string; who: string; now: boolean }> };
  ai: { active: number; sentToday: number; draftsToday: number } | null;
  soda: { pending: number; recent: Array<{ title: string; state: string; at: string }> };
}
export interface HqData {
  fullName: string | null; floor: HqFloor; liveNicks: number | null; nextMeetingAt: string | null; nextMeetingTitle: string | null;
  kpis: HqKpi[]; rooms: HqRoom[]; feed: HqFeedItem[]; team: HqMember[]; canSeeTeam: boolean; stats: HqStats; details: HqDetails;
}

type Row = Record<string, unknown>;
const VN_OFFSET = 7 * 3_600_000;
const NO_ID = "00000000-0000-0000-0000-000000000000";
const startOfVnDay = (now: number) => new Date(Math.floor((now + VN_OFFSET) / 86_400_000) * 86_400_000 - VN_OFFSET);
const fold = (value: string | null | undefined) => (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const initials = (name: string) => { const words = name.split(/\s+/u).filter(Boolean); return (words.length > 1 ? words.slice(-2) : words).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "?"; };
const time = (iso: string | number) => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const dayTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(iso));
const floorMatches = (floor: HqFloor, department: string | null | undefined) => floor === "ALL" || (floor === "REC" ? /\brec\b/u.test(fold(department)) : /\bsale\b/u.test(fold(department)));
const KIND_LABEL: Record<string, string> = { HOP: "Họp", PHONG_VAN: "Phỏng vấn", GAP_KHACH: "Gặp khách", CA_NHAN: "Cá nhân", KHAC: "Khác" };
const n = (value: number) => value.toLocaleString("vi-VN");

export async function getHqData(floorParam: string | undefined): Promise<HqData | null> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const workspaceId = account.workspaceId;
  const floor: HqFloor = floorParam === "rec" ? "REC" : floorParam === "sale" ? "SALE" : "ALL";
  const can = (key: string) => account.permissions.includes(key);
  const db = createPrivilegedClient();
  const supabase = await createClient();
  const now = Date.now(), dayStart = startOfVnDay(now);
  const [isAdmin, accessible, { data: profileRows }] = await Promise.all([
    isWorkspaceAdmin(), getAccessibleChannelAccountIds(),
    db.from("profiles").select("id,full_name,department,manager_id,avatar_url").eq("workspace_id", workspaceId),
  ]);
  const profiles = ((profileRows ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.full_name ?? "Thành viên"), department: typeof row.department === "string" ? row.department : null, managerId: typeof row.manager_id === "string" ? row.manager_id : null, avatarUrl: typeof row.avatar_url === "string" && row.avatar_url.startsWith("https://") ? row.avatar_url : null }));
  const departmentOf = new Map(profiles.map((person) => [person.id, person.department]));
  const seesAll = isAdmin || can("roles.view");
  const visiblePeople = seesAll ? new Set(profiles.map((person) => person.id)) : teamOf(account.userId, profiles.map((person) => ({ id: person.id, managerId: person.managerId })));

  // ---- Suối Nguồn: the "Chưa trả lời" rule, per nick (migration 139) ----
  const inbox = (async () => {
    if (!can("inbox.view")) return null;
    let query = db.from("channel_accounts").select("id,status,primary_profile_id,channel_type").eq("workspace_id", workspaceId).is("deleted_at", null);
    if (accessible) query = query.in("id", accessible.length ? accessible : [NO_ID]);
    const [{ data: accounts }, { data: bot }] = await Promise.all([query, db.from("assistant_bot_settings").select("channel_account_id,enabled").eq("workspace_id", workspaceId).maybeSingle()]);
    const botId = bot?.enabled && typeof bot.channel_account_id === "string" ? bot.channel_account_id : null; // Soda's nick is not in Suối Nguồn
    const nicks = ((accounts ?? []) as Row[]).filter((row) => String(row.id) !== botId);
    if (!nicks.length) return null;
    const ownerOfNick = new Map(nicks.map((row) => [String(row.id), typeof row.primary_profile_id === "string" ? row.primary_profile_id : null]));
    const { data } = await supabase.rpc("inbox_waiting_by_account", { p_account_ids: nicks.map((row) => String(row.id)), p_user_id: account.userId });
    const byOwner = new Map<string, number>();
    let waiting = 0, important = 0, tagged = 0, unowned = 0, capped = false;
    for (const row of (data ?? []) as Row[]) {
      const owner = ownerOfNick.get(String(row.channel_account_id)) ?? null;
      if (row.capped === true) capped = true;
      if (!floorMatches(floor, owner ? departmentOf.get(owner) : null)) continue;
      const count = Number(row.waiting) || 0;
      waiting += count; tagged += Number(row.tagged) || 0; important += Number(row.important) || 0;
      if (owner) byOwner.set(owner, (byOwner.get(owner) ?? 0) + count); else unowned += count;
    }
    return { waiting, important, tagged, unowned, capped, byOwner, liveNicks: nicks.filter((row) => row.channel_type === "ZALO" && row.status === "CONNECTED").length };
  })();

  // ---- Lịch hẹn (today) ----
  const calendar = (async () => {
    const scope = seesAll ? "ALL" as const : "TEAM" as const;
    const result = await listOccurrences({ workspaceId, userId: account.userId, permissions: account.permissions, isAdmin },
      { from: dayStart.getTime(), to: dayStart.getTime() + 86_400_000, scope }).catch(() => null);
    const today = result?.occurrences ?? [];
    const inMeeting = new Map<string, string>();
    for (const item of today) if (item.start <= now && now < item.end) for (const id of [item.createdBy, ...item.attendees.filter((a) => !a.declined).map((a) => a.id)]) inMeeting.set(id, item.title);
    const next = today.find((item) => item.start > now) ?? null;
    const events = today.map((item) => ({
      id: `${item.eventId}-${item.start}`, time: `${time(item.start)}–${time(item.end)}`, title: item.title, kind: KIND_LABEL[item.kind] ?? item.kind,
      who: [item.createdByName, ...item.attendees.filter((a) => !a.declined && a.id !== item.createdBy).map((a) => a.name)].slice(0, 4).join(", "), now: item.start <= now && now < item.end,
    }));
    return { today: today.length, interviews: today.filter((item) => item.kind === "PHONG_VAN").length, inMeeting, next, events, scope: result?.scope === "ALL" ? "Công ty" : "Team" };
  })();

  // ---- CV (same rows as the CV screen: active CVs the member may see) ----
  const cvs = (async () => {
    if (!can("cvs.view")) return null;
    const base = () => supabase.from("human_cvs").select("cv_id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("active", true);
    const [{ count: today }, { count: twoDays }, { count: total }, { data: blocks }] = await Promise.all([
      base().gte("human_created_at", dayStart.toISOString()), base().gte("human_created_at", new Date(dayStart.getTime() - 86_400_000).toISOString()), base(),
      supabase.from("human_cv_blocks").select("last_synced_at").eq("workspace_id", workspaceId).not("last_synced_at", "is", null).order("last_synced_at", { ascending: false }).limit(1),
    ]);
    const lastSync = ((blocks ?? []) as Row[])[0]?.last_synced_at;
    return { today: today ?? 0, yesterday: Math.max(0, (twoDays ?? 0) - (today ?? 0)), total: total ?? 0, lastSync: typeof lastSync === "string" ? dayTime(lastSync) : null };
  })();

  // ---- Zalo Marketing (the same list as its screen) ----
  const campaigns = (async () => {
    if (!can("campaigns.view")) return null;
    const list = await listChannelCampaigns().catch(() => []);
    const ids = list.map((row) => row.id);
    const { count: repliesToday } = ids.length
      ? await supabase.from("channel_campaign_recipients").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).in("campaign_id", ids.slice(0, 300)).eq("status", "REPLIED").gte("replied_at", dayStart.toISOString())
      : { count: 0 };
    const top = list.slice().sort((a, b) => Number(b.status === "RUNNING") - Number(a.status === "RUNNING") || b.replies - a.replies).slice(0, 6)
      .map((row) => ({ id: row.id, name: row.name, status: row.status, sent: row.sent, replies: row.replies, owner: row.ownerName }));
    return { running: list.filter((row) => row.status === "RUNNING").length, sent: list.reduce((sum, row) => sum + row.sent, 0), replies: list.reduce((sum, row) => sum + row.replies, 0), repliesToday: repliesToday ?? 0, campaigns: top };
  })();

  // ---- Gửi nhóm Zalo ----
  const broadcasts = (async () => {
    if (!can("broadcasts.view") && !isAdmin) return null;
    const [{ count }, { data }] = await Promise.all([
      db.from("zalo_broadcasts").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "RUNNING"),
      db.from("zalo_broadcasts").select("id,name,status,created_at").eq("workspace_id", workspaceId).neq("status", "DRAFT").order("created_at", { ascending: false }).limit(4),
    ]);
    return { running: count ?? 0, recent: ((data ?? []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name ?? "Gửi nhóm"), status: String(row.status), at: dayTime(String(row.created_at)) })) };
  })();

  // ---- AI Recruiter (administrators) ----
  const aiRecruiter = (async () => {
    if (!isAdmin) return null;
    const runs = (status: string) => db.from("ai_recruiter_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", status).gte("created_at", dayStart.toISOString());
    const [{ count: active }, { count: sentToday }, { count: draftsToday }] = await Promise.all([
      db.from("ai_recruiter_conversation_states").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
        .in("status", ["COLLECTING_PROFILE", "PROFILE_COMPLETE", "OFFERING_JOB", "DISCUSSING_PROCESS"]).gte("updated_at", new Date(now - 86_400_000).toISOString()),
      runs("SENT"), runs("DRAFT_READY"),
    ]);
    return { active: active ?? 0, sentToday: sentToday ?? 0, draftsToday: draftsToday ?? 0 };
  })();

  // ---- Soda: proposals waiting for this member, latest actions ----
  const soda = (async () => {
    let recentQuery = db.from("assistant_actions").select("kind,status,created_at,preview").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(4);
    if (!isAdmin) recentQuery = recentQuery.eq("user_id", account.userId);
    const [{ count: pending }, { data: recent }] = await Promise.all([
      db.from("assistant_actions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("user_id", account.userId).eq("status", "PROPOSED").gt("expires_at", new Date(now).toISOString()),
      recentQuery,
    ]);
    const state = (status: unknown) => status === "EXECUTED" ? "đã làm" : status === "CANCELLED" ? "đã huỷ" : status === "PROPOSED" ? "chờ xác nhận" : status === "EXPIRED" ? "hết hạn" : String(status).toLowerCase();
    return { pending: pending ?? 0, recent: ((recent ?? []) as Row[]).map((row) => ({ title: String(((row.preview ?? {}) as Row).title ?? row.kind), state: state(row.status), at: time(String(row.created_at)) })) };
  })();

  // Who is replying right now: a message they sent in the last 15 minutes.
  const typing = (async () => {
    const { data } = await db.from("channel_outbound_actions").select("approved_by").eq("workspace_id", workspaceId).eq("dispatch_source", "HUMAN_MANUAL").not("approved_by", "is", null)
      .gte("approved_at", new Date(now - 15 * 60_000).toISOString()).limit(500);
    return new Set(((data ?? []) as Row[]).map((row) => String(row.approved_by)));
  })();

  const feed = (async () => {
    const items: Array<HqFeedItem & { sort: number }> = [];
    const jobs: Array<Promise<void>> = [];
    if (can("inbox.view")) jobs.push((async () => {
      let query = supabase.from("omnichannel_conversations").select("id,subject,metadata,mention_pending_at").eq("workspace_id", workspaceId).not("mention_pending_at", "is", null).order("mention_pending_at", { ascending: false }).limit(3);
      if (accessible) query = query.in("channel_account_id", accessible.length ? accessible : [NO_ID]);
      const { data } = await query;
      for (const row of (data ?? []) as Row[]) {
        const meta = (row.metadata ?? {}) as Row;
        const name = String(meta.groupName ?? meta.conversationDisplayName ?? row.subject ?? "Nhóm Zalo");
        items.push({ kind: "@ tag", tone: "alert", text: `Nhóm “${name}” tag nick mình, chưa trả lời`, at: time(String(row.mention_pending_at)), href: `/inbox/all/${row.id}`, sort: Date.parse(String(row.mention_pending_at)) });
      }
    })());
    if (can("campaigns.view")) jobs.push((async () => {
      const { data } = await supabase.from("channel_campaign_recipients").select("replied_at,channel_campaigns(name),contacts(full_name)").eq("workspace_id", workspaceId).eq("status", "REPLIED").not("replied_at", "is", null).order("replied_at", { ascending: false }).limit(3);
      for (const row of (data ?? []) as Row[]) {
        const campaign = (Array.isArray(row.channel_campaigns) ? row.channel_campaigns[0] : row.channel_campaigns) as Row | null;
        const contact = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as Row | null;
        items.push({ kind: "Chiến dịch", tone: "meet", text: `${String(contact?.full_name ?? "Ứng viên")} phản hồi “${String(campaign?.name ?? "chiến dịch")}”`, at: time(String(row.replied_at)), href: "/campaigns/omnichannel", sort: Date.parse(String(row.replied_at)) });
      }
    })());
    jobs.push((async () => {
      let query = db.from("assistant_actions").select("kind,status,created_at,user_id,preview").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(3);
      if (!isAdmin) query = query.eq("user_id", account.userId);
      const { data } = await query;
      for (const row of (data ?? []) as Row[]) {
        const title = String(((row.preview ?? {}) as Row).title ?? row.kind);
        const state = row.status === "EXECUTED" ? "đã làm" : row.status === "CANCELLED" ? "đã huỷ" : row.status === "PROPOSED" ? "chờ xác nhận" : String(row.status).toLowerCase();
        items.push({ kind: "Soda", tone: "info", text: `${title} (${state})`, at: time(String(row.created_at)), href: "/assistant", sort: Date.parse(String(row.created_at)) });
      }
    })());
    if (isAdmin) jobs.push((async () => {
      const { data } = await db.from("ai_recruiter_runs").select("status,created_at,omnichannel_conversations(metadata)").eq("workspace_id", workspaceId).in("status", ["SENT", "DRAFT_READY"]).order("created_at", { ascending: false }).limit(3);
      for (const row of (data ?? []) as Row[]) {
        const conversation = (Array.isArray(row.omnichannel_conversations) ? row.omnichannel_conversations[0] : row.omnichannel_conversations) as Row | null;
        const meta = (conversation?.metadata ?? {}) as Row;
        const name = String(meta.participantDisplayName ?? meta.conversationDisplayName ?? "ứng viên");
        items.push({ kind: "AI Rec", tone: "info", text: row.status === "SENT" ? `Đã trả lời ${name}` : `Soạn nháp trả lời ${name}`, at: time(String(row.created_at)), href: "/settings/ai-recruiter", sort: Date.parse(String(row.created_at)) });
      }
    })());
    await Promise.all(jobs.map((job) => job.catch(() => undefined)));
    return items.sort((a, b) => b.sort - a.sort).slice(0, 10).map((item): HqFeedItem => ({ kind: item.kind, tone: item.tone, text: item.text, at: item.at, href: item.href }));
  })();

  const [inboxData, calendarData, cvData, campaignData, broadcastData, aiData, sodaData, typingNow, feedItems] = await Promise.all([inbox, calendar, cvs, campaigns, broadcasts, aiRecruiter, soda, typing, feed]);

  const team: HqMember[] = profiles
    .filter((person) => visiblePeople.has(person.id) && floorMatches(floor, person.department))
    .map((person) => {
      const waiting = inboxData?.byOwner.get(person.id) ?? 0;
      const meeting = calendarData.inMeeting.get(person.id);
      const replying = typingNow.has(person.id);
      const status = meeting ? { status: "Đang họp", tone: "meet" as const } : waiting >= 100 ? { status: "Cần xem", tone: "alert" as const } : replying ? { status: "Đang nhắn", tone: "busy" as const } : { status: "—", tone: "idle" as const };
      const doing = [meeting ? `Họp: ${meeting}` : replying ? "Đang trả lời tin" : null, inboxData ? `${n(waiting)} chưa trả lời` : null].filter(Boolean).join(" · ") || "Chưa có hoạt động";
      const seat = meeting ? "MEET" as const : /\brec\b/u.test(fold(person.department)) ? "REC" as const : /\bsale\b/u.test(fold(person.department)) ? "SALE" as const : null;
      return { id: person.id, name: person.name, initials: initials(person.name), department: person.department, doing, waiting, avatarUrl: person.avatarUrl, seat, ...status };
    })
    .sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name, "vi"))
    .slice(0, 40);

  const running = campaignData || broadcastData ? (campaignData?.running ?? 0) + (broadcastData?.running ?? 0) : null;
  const calendarHref = `/calendar?pham_vi=${seesAll ? "ALL" : "TEAM"}`;
  const kpis: HqKpi[] = [
    { key: "waiting", room: "inbox", label: "Chưa trả lời", value: inboxData?.waiting ?? null, note: inboxData ? `${n(inboxData.tagged)} nhóm tag mình · 30 ngày` : "Cần quyền Suối Nguồn", href: "/inbox/all?view=waiting", tone: "alert" },
    { key: "cv", room: "cv", label: "CV mới hôm nay", value: cvData?.today ?? null, note: cvData === null ? "Cần quyền CV" : `Hôm qua ${n(cvData.yesterday)} · tổng ${n(cvData.total)} CV`, href: "/cvs", tone: "info" },
    { key: "meet", room: "meeting", label: "Lịch hẹn hôm nay", value: calendarData.today, note: `${calendarData.interviews} phỏng vấn · ${calendarData.scope}`, href: calendarHref, tone: "meet" },
    { key: "replies", room: "tower", label: "Phản hồi chiến dịch Zalo", value: campaignData?.replies ?? null, note: campaignData ? `+${n(campaignData.repliesToday)} hôm nay · ${n(campaignData.sent)} tin gửi` : "Cần quyền Chiến dịch", href: "/campaigns/omnichannel", tone: "plain" },
  ];
  const peopleIn = (pattern: RegExp) => profiles.filter((person) => visiblePeople.has(person.id) && pattern.test(fold(person.department))).length;
  const rooms: HqRoom[] = [
    { key: "soda", name: "Lễ tân · Soda", meta: sodaData.pending ? `${sodaData.pending} chờ xác nhận` : "Trợ lý HireX", href: "/assistant", tone: "cyan" },
    { key: "inbox", name: "Trạm tin nhắn", meta: inboxData ? `${n(inboxData.waiting)} chờ` : "—", href: "/inbox/all?view=waiting", tone: "red" },
    { key: "tower", name: "Tháp phát sóng · Zalo Mkt", meta: running === null ? "—" : `${running} đang chạy`, href: "/campaigns/omnichannel", tone: "violet" },
    { key: "rec", name: "Phòng Rec", meta: `${peopleIn(/\brec\b/u)} người`, href: "/?tang=rec", tone: "cyan" },
    { key: "sale", name: "Phòng Sale", meta: `${peopleIn(/\bsale\b/u)} người`, href: "/?tang=sale", tone: "violet" },
    { key: "meeting", name: "Phòng họp", meta: `${calendarData.today} lịch hôm nay`, href: calendarHref, tone: "violet" },
    { key: "ai", name: "Bàn AI Recruiter", meta: aiData === null ? "—" : `${aiData.active} UV đang tư vấn`, href: "/settings/ai-recruiter", tone: "green" },
    { key: "cv", name: "Kho CV", meta: cvData === null ? "—" : `${cvData.today} mới hôm nay`, href: "/cvs", tone: "cyan" },
  ];
  const people = profiles.filter((person) => visiblePeople.has(person.id) && floorMatches(floor, person.department))
    .map((person) => ({ id: person.id, name: person.name, waiting: inboxData?.byOwner.get(person.id) ?? 0 })).filter((person) => person.waiting > 0)
    .sort((a, b) => b.waiting - a.waiting).slice(0, 8);
  return {
    fullName: account.fullName ?? null, floor, liveNicks: inboxData?.liveNicks ?? null,
    nextMeetingAt: calendarData.next ? new Date(calendarData.next.start).toISOString() : null, nextMeetingTitle: calendarData.next?.title ?? null,
    kpis, rooms, feed: feedItems, team, canSeeTeam: seesAll || visiblePeople.size > 1,
    stats: {
      waiting: inboxData?.waiting ?? null, tagged: inboxData?.tagged ?? null, sent: campaignData?.sent ?? null, replies: campaignData?.replies ?? null,
      running, aiActive: aiData?.active ?? null, cvToday: cvData?.today ?? null, meetingsToday: calendarData.today,
    },
    details: {
      inbox: inboxData ? { waiting: inboxData.waiting, personal: inboxData.waiting - inboxData.tagged, tagged: inboxData.tagged, important: inboxData.important, unowned: inboxData.unowned, capped: inboxData.capped, people } : null,
      zalo: campaignData ? { running: campaignData.running, sent: campaignData.sent, replies: campaignData.replies, repliesToday: campaignData.repliesToday, campaigns: campaignData.campaigns } : null,
      broadcasts: broadcastData,
      cv: cvData,
      calendar: { scope: calendarData.scope, events: calendarData.events },
      ai: aiData,
      soda: sodaData,
    },
  };
}
