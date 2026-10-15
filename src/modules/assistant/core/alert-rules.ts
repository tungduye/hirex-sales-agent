// Automatic alerts of Trợ lý HireX: who must hear about which problem. Pure; unit-tested.
// A background scan feeds the current state of a workspace in; the result is the set of alerts
// that SHOULD be open. Comparing it with the open alerts gives what to create and what to resolve,
// so a problem alerts once while it lasts and again only if it comes back after being fixed.

export type AlertKind = "CHANNEL_DOWN" | "EMAIL_WORKER_STALE" | "CUSTOMER_WAITING" | "RULE";
/** A proposal attached to an alert (from a rule): it runs only when the recipient presses "Xác nhận". */
export interface AlertProposal { kind: "CREATE_TASK"; params: Record<string, unknown>; preview: { title: string; lines: string[]; link?: string | null } }
export interface Alert { userId: string; kind: AlertKind; dedupeKey: string; severity: "high" | "medium"; title: string; body: string | null; link: string; ruleId?: string; proposal?: AlertProposal }
export interface AlertMember { id: string; isAdmin: boolean; permissions: string[]; allChannels: boolean; channelIds: string[] }
export interface AlertChannel { id: string; type: string; name: string | null; status: string; operatorEnabled: boolean; health: string | null; healthReason: string | null; lastError: string | null }
export interface AlertWaiting { id: string; channelAccountId: string; channel: string; name: string | null; account: string | null; since: string; hours: number; group: boolean; automated: boolean; assignedTo: string | null; lastInboundId: string }
export interface AlertScanInput {
  waitHours: number;
  members: AlertMember[];
  channels: AlertChannel[];
  emailWorker: { state: string; runningCampaigns: number } | null;
  waiting: AlertWaiting[];
}

/** Longest a waiting conversation keeps alerting; older ones are left to the daily brief. */
export const MAX_WAIT_ALERT_HOURS = 48;
/** At most this many "customer waiting" alerts per member are open at once (longest waits first). */
export const MAX_WAIT_ALERTS_PER_MEMBER = 15;

export const CHANNEL_LABELS: Record<string, string> = { ZALO: "Zalo", FACEBOOK: "Facebook Page", FACEBOOK_PROFILE: "Facebook cá nhân", EMAIL: "Email" };
export const channelLabel = (value: string) => CHANNEL_LABELS[value] ?? value;
export const has = (member: AlertMember, permission: string) => member.isAdmin || member.permissions.includes(permission);
export const canUseChannel = (member: AlertMember, channelAccountId: string) => member.allChannels || member.channelIds.includes(channelAccountId);

/** Same rule as the brief: switched-off accounts and unchecked health are not problems. */
export function channelProblem(channel: AlertChannel): string | null {
  if (!channel.operatorEnabled) return null;
  if (channel.status !== "CONNECTED") return channel.status;
  if (["DEGRADED", "DISCONNECTED", "AUTH_REQUIRED"].includes(String(channel.health))) return channel.healthReason ?? String(channel.health);
  return channel.lastError;
}

/** "21:48 14/10" in Vietnam time. The alert keeps its text, so it names the moment, not a duration that goes stale. */
export function sinceText(iso: string) {
  const shifted = new Date(Date.parse(iso) + 7 * 3_600_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())} ${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}`;
}

export function buildAlerts(input: AlertScanInput): Alert[] {
  const alerts: Alert[] = [];

  for (const channel of input.channels) {
    const reason = channelProblem(channel);
    if (!reason) continue;
    for (const member of input.members) {
      if (!has(member, "channels.manage") || !canUseChannel(member, channel.id)) continue;
      alerts.push({
        userId: member.id, kind: "CHANNEL_DOWN", dedupeKey: `channel:${channel.id}`, severity: "high",
        title: `${channelLabel(channel.type)} “${channel.name ?? "không tên"}” đang lỗi hoặc mất kết nối`,
        body: `Lý do: ${reason}. Tin nhắn và chiến dịch qua tài khoản này có thể bị gián đoạn.`, link: "/settings/channels",
      });
    }
  }

  if (input.emailWorker?.state === "STALE" && input.emailWorker.runningCampaigns > 0) {
    for (const member of input.members) {
      if (!has(member, "campaigns.launch")) continue;
      alerts.push({
        userId: member.id, kind: "EMAIL_WORKER_STALE", dedupeKey: "email_worker", severity: "high",
        title: "Bộ gửi chiến dịch email có thể đã dừng",
        body: `Hơn 10 phút chưa chạy xong lượt nào trong khi có ${input.emailWorker.runningCampaigns} chiến dịch email đang chạy.`, link: "/campaigns",
      });
    }
  }

  const waiting = input.waiting
    .filter((row) => !row.group && !row.automated && row.hours >= input.waitHours && row.hours <= MAX_WAIT_ALERT_HOURS)
    .sort((a, b) => b.hours - a.hours);
  const perMember = new Map<string, number>();
  for (const row of waiting) {
    const assignee = row.assignedTo ? input.members.find((member) => member.id === row.assignedTo && has(member, "inbox.view") && canUseChannel(member, row.channelAccountId)) : undefined;
    const recipients = assignee ? [assignee] : input.members.filter((member) => has(member, "inbox.reply") && canUseChannel(member, row.channelAccountId));
    for (const member of recipients) {
      const count = perMember.get(member.id) ?? 0;
      if (count >= MAX_WAIT_ALERTS_PER_MEMBER) continue;
      perMember.set(member.id, count + 1);
      alerts.push({
        userId: member.id, kind: "CUSTOMER_WAITING", dedupeKey: `wait:${row.id}:${row.lastInboundId}`, severity: row.hours >= 24 ? "high" : "medium",
        title: `${row.name ?? "Khách"} chờ trả lời từ ${sinceText(row.since)}`,
        body: `${channelLabel(row.channel)}${row.account ? ` · ${row.account}` : ""}${assignee ? " · hội thoại được giao cho anh/chị" : ""}`,
        link: `/inbox/all/${row.id}`,
      });
    }
  }
  return alerts;
}

export interface OpenAlert { id: string; userId: string; dedupeKey: string }

/** What to create (problems without an open alert) and what to resolve (open alerts whose problem is gone). */
export function diffAlerts(desired: Alert[], open: OpenAlert[]) {
  const key = (userId: string, dedupeKey: string) => `${userId}|${dedupeKey}`;
  const openKeys = new Set(open.map((row) => key(row.userId, row.dedupeKey)));
  const desiredKeys = new Set(desired.map((row) => key(row.userId, row.dedupeKey)));
  const seen = new Set<string>();
  const toCreate = desired.filter((row) => {
    const k = key(row.userId, row.dedupeKey);
    if (openKeys.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const toResolve = open.filter((row) => !desiredKeys.has(key(row.userId, row.dedupeKey))).map((row) => row.id);
  return { toCreate, toResolve };
}
