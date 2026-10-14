// "Bản tin hôm nay" of Trợ lý HireX: turns the member's own data (already filtered by their
// permissions) into a short list of things to handle, most urgent first. Pure; unit-tested.

export type BriefArea = "inbox" | "channels" | "email_worker" | "campaigns" | "tasks" | "ai_recruiter";
export type BriefSeverity = "high" | "medium";
export interface BriefItem { area: BriefArea; severity: BriefSeverity; title: string; details: string[]; link: string | null }
export interface BriefOk { area: BriefArea; text: string }
export interface DailyBrief { date: string; generatedAt: string; items: BriefItem[]; ok: BriefOk[]; failed: BriefArea[] }

export interface WaitingConversation { name: string | null; channel: string; account: string | null; hours: number; group: boolean; link: string }
export interface BriefInput {
  now: Date;
  inbox?: { waiting: WaitingConversation[] } | null;
  channels?: { problems: { channel: string; name: string | null; reason: string | null }[]; gmailProblems: { email: string; status: string }[] } | null;
  emailWorker?: { state: string } | null;
  campaigns?: { running: { name: string; channel: string; sent: number; failed: number | null; link: string }[] } | null;
  tasks?: { open: { title: string; dueAt: string | null; link: string }[] } | null;
  aiRecruiter?: { errors: Record<string, number> } | null;
}

export const AREA_LABELS: Record<BriefArea, string> = {
  inbox: "Hồ Chứa", channels: "Tài khoản kết nối", email_worker: "Bộ gửi email", campaigns: "Chiến dịch", tasks: "Công việc", ai_recruiter: "AI Recruiter",
};
const CHANNEL_LABELS: Record<string, string> = { ZALO: "Zalo", FACEBOOK: "Facebook Page", FACEBOOK_PROFILE: "Facebook cá nhân", EMAIL: "Email" };
const channelLabel = (value: string) => CHANNEL_LABELS[value] ?? value;
const AREA_ORDER: BriefArea[] = ["channels", "email_worker", "inbox", "tasks", "campaigns", "ai_recruiter"];

/** Minimum wait (hours) before an unanswered conversation appears in the brief. */
export const WAIT_HOURS = 2;
const LONG_WAIT_HOURS = 24;
const VN_OFFSET_MS = 7 * 3_600_000;

/** Calendar date in Vietnam (UTC+7) as YYYY-MM-DD. */
export function vietnamDate(now: Date) {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function hoursText(hours: number) {
  if (hours >= 48) return `${Math.floor(hours / 24)} ngày`;
  return `${Math.max(1, Math.round(hours))} giờ`;
}

function more(total: number, shown: number) {
  return total > shown ? [`… và ${total - shown} mục khác`] : [];
}

export function composeBrief(input: BriefInput): DailyBrief {
  const items: BriefItem[] = [];
  const ok: BriefOk[] = [];
  const failed: BriefArea[] = [];
  const today = vietnamDate(input.now);

  if (input.inbox === null) failed.push("inbox");
  else if (input.inbox) {
    const people = input.inbox.waiting.filter((row) => !row.group && row.hours >= WAIT_HOURS).sort((a, b) => b.hours - a.hours);
    const groups = input.inbox.waiting.filter((row) => row.group && row.hours >= WAIT_HOURS).length;
    if (people.length) {
      const long = people.filter((row) => row.hours >= LONG_WAIT_HOURS).length;
      items.push({
        area: "inbox", severity: long > 0 || people.length >= 10 ? "high" : "medium",
        title: `${people.length} hội thoại chờ trả lời quá ${WAIT_HOURS} giờ${long ? ` (${long} hội thoại quá 1 ngày)` : ""}`,
        details: [
          ...people.slice(0, 5).map((row) => `${row.name ?? "Khách chưa rõ tên"} · ${channelLabel(row.channel)}${row.account ? ` (${row.account})` : ""} · chờ ${hoursText(row.hours)}`),
          ...more(people.length, 5),
          ...(groups ? [`Chưa tính ${groups} nhóm chat`] : []),
        ],
        link: people.length === 1 ? people[0].link : "/inbox/all",
      });
    } else ok.push({ area: "inbox", text: `Không có khách/ứng viên nào chờ trả lời quá ${WAIT_HOURS} giờ${groups ? ` (chỉ có ${groups} nhóm chat)` : ""}` });
  }

  if (input.channels === null) failed.push("channels");
  else if (input.channels) {
    const { problems, gmailProblems } = input.channels;
    if (problems.length) items.push({
      area: "channels", severity: "high", title: `${problems.length} tài khoản kết nối đang lỗi hoặc mất kết nối`,
      details: [...problems.slice(0, 5).map((row) => `${channelLabel(row.channel)} · ${row.name ?? "không tên"}${row.reason ? ` — ${row.reason}` : ""}`), ...more(problems.length, 5)],
      link: "/settings/channels",
    });
    if (gmailProblems.length) items.push({
      area: "channels", severity: "medium", title: `${gmailProblems.length} hộp thư Gmail cần kiểm tra`,
      details: [...gmailProblems.slice(0, 5).map((row) => `${row.email} — ${row.status}`), ...more(gmailProblems.length, 5)],
      link: "/settings/channels",
    });
    if (!problems.length && !gmailProblems.length) ok.push({ area: "channels", text: "Mọi tài khoản kết nối đều hoạt động bình thường" });
  }

  if (input.emailWorker === null) failed.push("email_worker");
  else if (input.emailWorker) {
    const state = input.emailWorker.state;
    if (state === "STALE") items.push({ area: "email_worker", severity: "high", title: "Bộ gửi chiến dịch email có thể đã dừng (hơn 10 phút chưa chạy)", details: [], link: "/campaigns" });
    else if (state === "WARNING") items.push({ area: "email_worker", severity: "medium", title: "Bộ gửi chiến dịch email đang chạy chậm", details: [], link: "/campaigns" });
    else if (state === "UNKNOWN") items.push({ area: "email_worker", severity: "medium", title: "Không đọc được trạng thái bộ gửi chiến dịch email", details: [], link: "/campaigns" });
    else ok.push({ area: "email_worker", text: "Bộ gửi chiến dịch email chạy đều" });
  }

  if (input.campaigns === null) failed.push("campaigns");
  else if (input.campaigns) {
    const running = input.campaigns.running;
    const failing = running.filter((row) => (row.failed ?? 0) >= 3 && (row.failed ?? 0) / Math.max(1, row.sent + (row.failed ?? 0)) >= 0.1);
    for (const row of failing.slice(0, 3)) items.push({
      area: "campaigns", severity: "medium", title: `Chiến dịch “${row.name}” có tỷ lệ lỗi cao`,
      details: [`${channelLabel(row.channel)} · đã gửi ${row.sent.toLocaleString("vi-VN")} · lỗi ${(row.failed ?? 0).toLocaleString("vi-VN")}`],
      link: row.link,
    });
    if (!failing.length) ok.push({ area: "campaigns", text: running.length ? `${running.length} chiến dịch đang chạy, không có lỗi đáng kể` : "Không có chiến dịch nào đang chạy" });
  }

  if (input.tasks === null) failed.push("tasks");
  else if (input.tasks) {
    const withDue = input.tasks.open.filter((row) => row.dueAt);
    const overdue = withDue.filter((row) => Date.parse(row.dueAt!) < input.now.getTime());
    const dueToday = withDue.filter((row) => Date.parse(row.dueAt!) >= input.now.getTime() && vietnamDate(new Date(row.dueAt!)) === today);
    const line = (row: { title: string; dueAt: string | null }) => `${row.title}${row.dueAt ? ` — hạn ${new Intl.DateTimeFormat("vi-VN", { timeStyle: "short", dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(row.dueAt))}` : ""}`;
    if (overdue.length) items.push({ area: "tasks", severity: "high", title: `${overdue.length} công việc của anh/chị đã quá hạn`, details: [...overdue.slice(0, 3).map(line), ...more(overdue.length, 3)], link: "/tasks" });
    if (dueToday.length) items.push({ area: "tasks", severity: "medium", title: `${dueToday.length} công việc đến hạn hôm nay`, details: [...dueToday.slice(0, 3).map(line), ...more(dueToday.length, 3)], link: "/tasks" });
    if (!overdue.length && !dueToday.length) ok.push({ area: "tasks", text: "Không có công việc quá hạn hay đến hạn hôm nay" });
  }

  if (input.aiRecruiter === null) failed.push("ai_recruiter");
  else if (input.aiRecruiter) {
    const errors = Object.entries(input.aiRecruiter.errors).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
    const total = errors.reduce((sum, [, count]) => sum + count, 0);
    if (total) items.push({ area: "ai_recruiter", severity: "medium", title: `AI Recruiter gặp ${total} lỗi trong 24 giờ qua`, details: errors.slice(0, 4).map(([code, count]) => `${code}: ${count} lần`), link: "/settings/ai-recruiter" });
    else ok.push({ area: "ai_recruiter", text: "AI Recruiter không có lỗi trong 24 giờ qua" });
  }

  const rank = (item: BriefItem) => (item.severity === "high" ? 0 : 100) + AREA_ORDER.indexOf(item.area);
  items.sort((a, b) => rank(a) - rank(b));
  return { date: today, generatedAt: input.now.toISOString(), items, ok, failed };
}

/** Plain-text version for the assistant (model input). */
export function briefForModel(brief: DailyBrief) {
  return {
    ngay: brief.date,
    cap_nhat_luc: brief.generatedAt,
    can_xu_ly: brief.items.map((item) => ({ muc: AREA_LABELS[item.area], muc_do: item.severity === "high" ? "GẤP" : "NÊN XEM", noi_dung: item.title, chi_tiet: item.details, link: item.link })),
    on_dinh: brief.ok.map((item) => `${AREA_LABELS[item.area]}: ${item.text}`),
    khong_tai_duoc: brief.failed.map((area) => AREA_LABELS[area]),
  };
}
