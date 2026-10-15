// "Quy tắc tự động" of Trợ lý HireX (phase 3, step 3). A member describes a rule in Vietnamese; the
// assistant turns it into this structured form (checked here), the member confirms it on a card,
// and the alert scan evaluates it every 5 minutes. A rule can only NOTIFY people or attach a
// PROPOSAL (a task to create) that the recipient must still confirm — it never acts by itself.
// Pure; unit-tested.
import { z } from "zod";
import { canUseChannel, channelLabel, has, sinceText, type Alert, type AlertMember } from "./alert-rules.ts";

export const RULE_TRIGGERS = ["CUSTOMER_WAITING", "TASK_OVERDUE", "LEAD_STALE"] as const;
export const RULE_ACTIONS = ["NOTIFY", "PROPOSE_TASK"] as const;
export const RULE_TARGETS = ["OWNER", "RESPONSIBLE", "ADMINS"] as const;
export const RULE_CHANNELS = ["ZALO", "FACEBOOK", "FACEBOOK_PROFILE", "EMAIL"] as const;

export const ruleSchema = z.discriminatedUnion("trigger", [
  z.object({ trigger: z.literal("CUSTOMER_WAITING"), hours: z.number().min(1).max(72), channels: z.array(z.enum(RULE_CHANNELS)).max(4), action: z.enum(RULE_ACTIONS), target: z.enum(RULE_TARGETS), dueHours: z.number().int().min(0).max(72) }).strict(),
  z.object({ trigger: z.literal("TASK_OVERDUE"), hours: z.number().min(0).max(168), action: z.literal("NOTIFY"), target: z.enum(RULE_TARGETS) }).strict(),
  z.object({ trigger: z.literal("LEAD_STALE"), days: z.number().int().min(1).max(60), action: z.enum(RULE_ACTIONS), target: z.enum(RULE_TARGETS), dueHours: z.number().int().min(0).max(72) }).strict(),
]);
export type RuleDefinition = z.infer<typeof ruleSchema>;
export interface StoredRule { id: string; ownerId: string; name: string; enabled: boolean; definition: RuleDefinition }

/** At most this many rules per member. */
export const MAX_RULES_PER_OWNER = 20;
/** At most this many alerts one rule opens for one recipient (longest waits / oldest tasks first). */
export const MAX_RULE_ALERTS_PER_RECIPIENT = 10;

/** Assistant tool arguments → a checked rule. Members who are not admins can only alert themselves. */
export function ruleFromToolArgs(args: Record<string, unknown>, isAdmin: boolean): { ok: true; name: string; rule: RuleDefinition } | { ok: false; error: string } {
  const name = typeof args.ten === "string" ? args.ten.trim().slice(0, 120) : "";
  if (!name) return { ok: false, error: "Thiếu tên quy tắc." };
  const target = String(args.gui_cho);
  if (!isAdmin && target !== "OWNER") return { ok: false, error: "Tài khoản không phải quản trị viên chỉ đặt được quy tắc báo cho chính mình (gui_cho = OWNER)." };
  const candidate = args.dieu_kien === "CUSTOMER_WAITING"
    ? { trigger: "CUSTOMER_WAITING", hours: args.so_gio, channels: Array.isArray(args.kenh) ? [...new Set(args.kenh)] : [], action: args.hanh_dong, target, dueHours: args.han_cong_viec_gio ?? 2 }
    : args.dieu_kien === "TASK_OVERDUE"
      ? { trigger: "TASK_OVERDUE", hours: args.so_gio ?? 0, action: args.hanh_dong, target }
      : { trigger: "LEAD_STALE", days: args.so_ngay, action: args.hanh_dong, target, dueHours: args.han_cong_viec_gio ?? 24 };
  const parsed = ruleSchema.safeParse(candidate);
  if (!parsed.success) {
    if (args.dieu_kien === "TASK_OVERDUE" && args.hanh_dong !== "NOTIFY") return { ok: false, error: "Quy tắc công việc quá hạn chỉ gửi thông báo." };
    return { ok: false, error: "Quy tắc chưa hợp lệ: khách chờ 1–72 giờ, công việc quá hạn 0–168 giờ, lead mới 1–60 ngày." };
  }
  return { ok: true, name, rule: parsed.data };
}

const TARGET_TEXT: Record<string, Record<(typeof RULE_TARGETS)[number], string>> = {
  CUSTOMER_WAITING: { OWNER: "anh/chị (người tạo quy tắc)", RESPONSIBLE: "người phụ trách hội thoại (người được giao, nếu chưa giao thì những người trả lời được trên tài khoản đó)", ADMINS: "quản trị viên" },
  TASK_OVERDUE: { OWNER: "anh/chị (người tạo quy tắc)", RESPONSIBLE: "người được giao công việc", ADMINS: "quản trị viên" },
  LEAD_STALE: { OWNER: "anh/chị (người tạo quy tắc)", RESPONSIBLE: "những người được sửa liên hệ", ADMINS: "quản trị viên" },
};

/** Plain Vietnamese description, shown on the confirmation card and the rules page. */
export function describeRule(rule: RuleDefinition): string[] {
  const when = rule.trigger === "CUSTOMER_WAITING"
    ? `Khi khách/ứng viên nhắn riêng chờ trả lời quá ${rule.hours} giờ${rule.channels.length ? ` (kênh ${rule.channels.map(channelLabel).join(", ")})` : ""}`
    : rule.trigger === "TASK_OVERDUE"
      ? `Khi công việc quá hạn${rule.hours ? ` hơn ${rule.hours} giờ` : ""}`
      : `Khi có lead "Mới" được tạo quá ${rule.days} ngày mà chưa đổi trạng thái`;
  const what = rule.action === "NOTIFY"
    ? "gửi thông báo vào chuông"
    : `gửi thông báo kèm đề xuất tạo công việc (hạn ${"dueHours" in rule ? rule.dueHours : 0} giờ), người nhận bấm Xác nhận mới tạo`;
  return [when, `Thì: ${what}`, `Cho: ${TARGET_TEXT[rule.trigger][rule.target]}`, "Kiểm tra 5 phút một lần; hết điều kiện thì thông báo tự ẩn."];
}

export interface RuleWaiting { id: string; channelAccountId: string; channel: string; name: string | null; account: string | null; since: string; hours: number; group: boolean; automated: boolean; assignedTo: string | null; lastInboundId: string }
export interface RuleTask { id: string; title: string; assignedTo: string | null; dueAt: string; conversationId: string | null }
export interface RuleInput {
  now: Date;
  members: AlertMember[];
  rules: StoredRule[];
  waiting: RuleWaiting[];
  overdueTasks: RuleTask[];
  /** Number of "NEW" leads older than N days, per rule id (only for LEAD_STALE rules). */
  staleLeads: Record<string, number>;
}

function recipients(rule: StoredRule, members: AlertMember[], responsible: () => AlertMember[]): AlertMember[] {
  const owner = members.find((member) => member.id === rule.ownerId);
  if (!owner) return [];
  // Only admins may alert other people (also checked when the rule was created).
  if (rule.definition.target === "OWNER" || !owner.isAdmin) return [owner];
  if (rule.definition.target === "ADMINS") return members.filter((member) => member.isAdmin);
  return responsible();
}

const dueIso = (now: Date, hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();

export function evaluateRules(input: RuleInput): Alert[] {
  const alerts: Alert[] = [];
  for (const rule of input.rules) {
    if (!rule.enabled) continue;
    const definition = rule.definition;
    const owner = input.members.find((member) => member.id === rule.ownerId);
    if (!owner) continue;
    const counts = new Map<string, number>();
    const push = (member: AlertMember, alert: Omit<Alert, "userId" | "kind" | "ruleId">) => {
      const count = counts.get(member.id) ?? 0;
      if (count >= MAX_RULE_ALERTS_PER_RECIPIENT) return;
      counts.set(member.id, count + 1);
      const proposal = alert.proposal && has(member, "tasks.create") ? alert.proposal : undefined;
      alerts.push({ ...alert, userId: member.id, kind: "RULE", ruleId: rule.id, proposal: proposal ? { ...proposal, params: { ...proposal.params, assigneeId: member.id } } : undefined });
    };

    if (definition.trigger === "CUSTOMER_WAITING") {
      const rows = input.waiting
        .filter((row) => !row.group && !row.automated && row.hours >= definition.hours && (!definition.channels.length || (definition.channels as string[]).includes(row.channel)))
        .sort((a, b) => b.hours - a.hours);
      for (const row of rows) {
        // The owner must be allowed to see the conversation for the rule to apply to it at all.
        if (!has(owner, "inbox.view") || !canUseChannel(owner, row.channelAccountId)) continue;
        const responsible = () => {
          const assignee = row.assignedTo ? input.members.find((member) => member.id === row.assignedTo && has(member, "inbox.view") && canUseChannel(member, row.channelAccountId)) : undefined;
          return assignee ? [assignee] : input.members.filter((member) => has(member, "inbox.reply") && canUseChannel(member, row.channelAccountId));
        };
        const who = `${row.name ?? "Khách"}`;
        for (const member of recipients(rule, input.members, responsible)) {
          if (!canUseChannel(member, row.channelAccountId)) continue;
          push(member, {
            dedupeKey: `rule:${rule.id}:wait:${row.id}:${row.lastInboundId}`, severity: row.hours >= 24 ? "high" : "medium",
            title: `[${rule.name}] ${who} chờ trả lời từ ${sinceText(row.since)}`,
            body: `${channelLabel(row.channel)}${row.account ? ` · ${row.account}` : ""}`,
            link: `/inbox/all/${row.id}`,
            proposal: definition.action === "PROPOSE_TASK" ? {
              kind: "CREATE_TASK",
              params: { title: `Trả lời ${who} (${channelLabel(row.channel)})`.slice(0, 240), dueAt: dueIso(input.now, definition.dueHours), conversationId: row.id },
              preview: { title: "Tạo công việc", lines: [`Công việc: Trả lời ${who}`, `Hạn: sau ${definition.dueHours} giờ`, `Từ quy tắc: ${rule.name}`], link: `/inbox/all/${row.id}` },
            } : undefined,
          });
        }
      }
    }

    if (definition.trigger === "TASK_OVERDUE") {
      const limit = input.now.getTime() - definition.hours * 3_600_000;
      const rows = input.overdueTasks.filter((task) => Date.parse(task.dueAt) <= limit).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
      for (const task of rows) {
        // Members who are not admins only follow their own tasks.
        if (!owner.isAdmin && task.assignedTo !== owner.id) continue;
        const responsible = () => input.members.filter((member) => member.id === task.assignedTo && has(member, "tasks.view"));
        for (const member of recipients(rule, input.members, responsible)) {
          push(member, {
            dedupeKey: `rule:${rule.id}:task:${task.id}`, severity: "medium",
            title: `[${rule.name}] Công việc quá hạn: ${task.title.slice(0, 120)}`,
            body: `Hạn ${sinceText(task.dueAt)}`, link: task.conversationId ? `/inbox/all/${task.conversationId}` : "/tasks",
          });
        }
      }
    }

    if (definition.trigger === "LEAD_STALE") {
      const count = input.staleLeads[rule.id] ?? 0;
      if (count > 0 && has(owner, "contacts.view")) {
        const responsible = () => input.members.filter((member) => has(member, "contacts.update"));
        for (const member of recipients(rule, input.members, responsible)) {
          if (!has(member, "contacts.view")) continue;
          push(member, {
            dedupeKey: `rule:${rule.id}:leads`, severity: "medium",
            title: `[${rule.name}] Có lead "Mới" chưa liên hệ quá ${definition.days} ngày`,
            body: `${count} lead lúc kiểm tra ${sinceText(input.now.toISOString())}`, link: "/contacts?status=NEW",
            proposal: definition.action === "PROPOSE_TASK" ? {
              kind: "CREATE_TASK",
              params: { title: `Liên hệ ${count} lead mới quá ${definition.days} ngày`, dueAt: dueIso(input.now, definition.dueHours), conversationId: null },
              preview: { title: "Tạo công việc", lines: [`Công việc: Liên hệ ${count} lead mới`, `Hạn: sau ${definition.dueHours} giờ`, `Từ quy tắc: ${rule.name}`], link: "/contacts?status=NEW" },
            } : undefined,
          });
        }
      }
    }
  }
  return alerts;
}
