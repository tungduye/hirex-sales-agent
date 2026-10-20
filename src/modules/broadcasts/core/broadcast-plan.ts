// Gửi hàng loạt vào nhóm Zalo: when the next group may be sent, per nick. Pure; unit-tested
// (tests/broadcast-plan.test.mjs). Times are Vietnam time (UTC+7).

const VN = 7 * 3_600_000;
const DAY = 86_400_000;

export const BROADCAST_DEFAULTS = { dailyCapPerNick: 30, minGapSeconds: 90, maxGapSeconds: 180, windowStartHour: 8, windowEndHour: 21 } as const;
export const MAX_TARGETS_PER_BROADCAST = 500;
export const MAX_ATTEMPTS = 3;

export interface PlanBroadcast { id: string; sendMessage: boolean; pinNote: boolean; dailyCapPerNick: number; minGapSeconds: number; maxGapSeconds: number; windowStartHour: number; windowEndHour: number }
export interface PlanTarget { id: string; broadcastId: string; accountId: string; position: number; status: string; pinStatus: string; attempts: number; pinAttempts: number; doneAt: string | null; updatedAt: string }
/** What the nick did today and last, over every broadcast (so two broadcasts never double a nick's pace). */
export interface NickActivity { doneToday: number; lastAt: number | null; lastKey: string | null }

export const vnDayStart = (now: number) => Math.floor((now + VN) / DAY) * DAY - VN;
export const vnHour = (now: number) => new Date(now + VN).getUTCHours();
export function windowOpen(now: number, startHour: number, endHour: number) { const hour = vnHour(now); return hour >= startHour && hour < endHour; }

/** A gap between the min and max, fixed for a given previous send (stable across worker ticks). */
export function gapSeconds(lastKey: string | null, min: number, max: number) {
  if (max <= min) return min;
  let hash = 2166136261;
  for (const char of lastKey ?? "") hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return min + (hash % (max - min + 1));
}

export type Step = { targetId: string; broadcastId: string; accountId: string; action: "SEND" | "PIN" };

/** What a target still needs: its message (then the pin, if asked), or only the pin. */
export function pendingAction(broadcast: Pick<PlanBroadcast, "sendMessage" | "pinNote">, target: Pick<PlanTarget, "status" | "pinStatus">): "SEND" | "PIN" | null {
  if (target.status === "PENDING") return broadcast.sendMessage ? "SEND" : "PIN";
  if (target.status === "SENT" && broadcast.pinNote && target.pinStatus === "PENDING") return "PIN";
  return null;
}

/**
 * At most one step per nick: the first waiting group (by broadcast order, then position) of a nick whose
 * window is open, whose daily cap is not reached and whose gap since its last step has passed. A failed
 * attempt waits the same gap before the next try.
 */
export function nextSteps(broadcasts: PlanBroadcast[], targets: PlanTarget[], activity: ReadonlyMap<string, NickActivity>, now: number, limit = 4): Step[] {
  const byId = new Map(broadcasts.map((broadcast) => [broadcast.id, broadcast]));
  const order = new Map(broadcasts.map((broadcast, index) => [broadcast.id, index]));
  const waiting = targets.flatMap((target) => {
    const broadcast = byId.get(target.broadcastId);
    const action = broadcast ? pendingAction(broadcast, target) : null;
    return broadcast && action ? [{ target, broadcast, action }] : [];
  }).sort((a, b) => (order.get(a.broadcast.id)! - order.get(b.broadcast.id)!) || a.target.position - b.target.position);
  const steps: Step[] = [];
  const decided = new Set<string>();
  for (const { target, broadcast, action } of waiting) {
    if (steps.length >= limit) break;
    if (decided.has(target.accountId)) continue;
    if (!windowOpen(now, broadcast.windowStartHour, broadcast.windowEndHour)) continue;
    decided.add(target.accountId);
    const nick = activity.get(target.accountId) ?? { doneToday: 0, lastAt: null, lastKey: null };
    // The cap counts groups finished today; a pin after an earlier send is not a new group.
    if (action === "SEND" || target.status === "PENDING") { if (nick.doneToday >= broadcast.dailyCapPerNick) continue; }
    const lastTry = target.attempts + target.pinAttempts > 0 ? Date.parse(target.updatedAt) : 0;
    const last = Math.max(nick.lastAt ?? 0, lastTry);
    if (last && now - last < gapSeconds(nick.lastKey ?? target.id, broadcast.minGapSeconds, broadcast.maxGapSeconds) * 1000) continue;
    steps.push({ targetId: target.id, broadcastId: broadcast.id, accountId: target.accountId, action });
  }
  return steps;
}

/** One group per nick: among the chosen nicks that are in a group, the one with the fewest groups so far. */
export function assignNicks(groups: Array<{ groupId: string; accounts: string[] }>, preferred: readonly string[]): Map<string, string> {
  const load = new Map<string, number>(preferred.map((id) => [id, 0]));
  const out = new Map<string, string>();
  const sorted = [...groups].sort((a, b) => a.accounts.length - b.accounts.length || a.groupId.localeCompare(b.groupId));
  for (const group of sorted) {
    const options = group.accounts.filter((id) => load.has(id));
    if (!options.length) continue;
    const pick = options.reduce((best, id) => (load.get(id)! < load.get(best)! ? id : best), options[0]);
    out.set(group.groupId, pick);
    load.set(pick, load.get(pick)! + 1);
  }
  return out;
}
