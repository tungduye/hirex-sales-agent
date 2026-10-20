import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { ZaloBridgeAdapter } from "@/modules/channels/adapters/zalo/zalo-bridge-adapter";
import { ChannelAdapterRegistry } from "@/modules/channels/core/channel-adapter-registry";
import { executeChannelOutboundAction } from "@/modules/channels/server/execute-channel-outbound-action";
import { loadChannelAdapterByAccountId } from "@/modules/channels/server/load-channel-adapter";
import { MAX_ATTEMPTS, nextSteps, vnDayStart, type NickActivity, type PlanBroadcast, type PlanTarget, type Step } from "../core/broadcast-plan";

// One tick of every running group broadcast: at most one group per nick, paced by broadcast-plan.ts.
// Called by the Trợ lý worker route about every 20 s. A send that may have reached Zalo is never retried.

type Row = Record<string, unknown>;
type Db = ReturnType<typeof createPrivilegedClient>;
const RETRYABLE = new Set(["ACCOUNT_BUSY", "ACCOUNT_UNAVAILABLE", "RATE_LIMITED", "UNAVAILABLE", "DEFERRED"]);

async function finishBroadcasts(db: Db, ids: string[]) {
  for (const id of ids) {
    const { count } = await db.from("zalo_broadcast_targets").select("id", { count: "exact", head: true }).eq("broadcast_id", id)
      .or("status.eq.PENDING,and(status.eq.SENT,pin_status.eq.PENDING),and(status.eq.SENT,message_pin_status.eq.PENDING)");
    if ((count ?? 0) === 0) await db.from("zalo_broadcasts").update({ status: "DONE", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "RUNNING");
  }
}

/** The pinned note ("Ghi chú"). standalone: the broadcast only adds notes, so the note finishes the group. */
async function note(db: Db, step: Step, broadcast: Row, target: Row, standalone: boolean) {
  const attempt = Number(target.pin_attempts ?? 0) + 1;
  let ok = false;
  try {
    const loaded = await loadChannelAdapterByAccountId(step.accountId);
    if (loaded.adapter instanceof ZaloBridgeAdapter)
      ok = await loaded.adapter.pinGroupNote({ groupId: String(target.group_id), kind: "NOTE", text: String(broadcast.text_content), messageId: null }, `group-broadcast:${step.targetId}:note:${attempt}`);
  } catch { ok = false; }
  const now = new Date().toISOString();
  const last = attempt >= MAX_ATTEMPTS;
  await db.from("zalo_broadcast_targets").update({
    pin_attempts: attempt, pin_status: ok ? "PINNED" : last ? "FAILED" : "PENDING",
    ...(standalone ? (ok ? { status: "SENT", done_at: now } : last ? { status: "FAILED", done_at: now, error_code: "NOTE_FAILED" } : {}) : {}),
    ...(!ok && !standalone && last ? { error_code: "NOTE_FAILED" } : {}),
  }).eq("id", step.targetId);
  return ok;
}

/** Pins the broadcast message this nick sent into the group ("Tin ghim"). */
async function pinMessage(db: Db, step: Step, broadcast: Row, target: Row) {
  const attempt = Number(target.message_pin_attempts ?? 0) + 1;
  let ok = false;
  const { data: action } = target.outbound_action_id ? await db.from("channel_outbound_actions").select("provider_message_id,status").eq("id", String(target.outbound_action_id)).maybeSingle() : { data: null };
  const messageId = typeof action?.provider_message_id === "string" ? action.provider_message_id : null;
  if (messageId) {
    try {
      const loaded = await loadChannelAdapterByAccountId(step.accountId);
      if (loaded.adapter instanceof ZaloBridgeAdapter)
        ok = await loaded.adapter.pinGroupNote({ groupId: String(target.group_id), kind: "MESSAGE", text: String(broadcast.text_content), messageId }, `group-broadcast:${step.targetId}:pin:${attempt}`);
    } catch { ok = false; }
  }
  const last = attempt >= MAX_ATTEMPTS || !messageId;
  await db.from("zalo_broadcast_targets").update({ message_pin_attempts: attempt, message_pin_status: ok ? "PINNED" : last ? "FAILED" : "PENDING", ...(!ok && last ? { error_code: messageId ? "PIN_FAILED" : "NO_MESSAGE_ID" } : {}) }).eq("id", step.targetId);
  return ok;
}

export async function runBroadcastTick(now = Date.now()) {
  const db = createPrivilegedClient();
  const { data: running } = await db.from("zalo_broadcasts").select("id,workspace_id,send_message,pin_message,pin_note,text_content,daily_cap_per_nick,min_gap_seconds,max_gap_seconds,window_start_hour,window_end_hour,approved_at")
    .eq("status", "RUNNING").order("approved_at").limit(50);
  const broadcasts = (running ?? []) as Row[];
  if (!broadcasts.length) return { steps: 0 };
  const ids = broadcasts.map((row) => String(row.id));
  const { data: open } = await db.from("zalo_broadcast_targets").select("id,broadcast_id,channel_account_id,position,status,pin_status,message_pin_status,attempts,pin_attempts,message_pin_attempts,done_at,updated_at,group_id,outbound_action_id")
    .in("broadcast_id", ids).or("status.eq.PENDING,and(status.eq.SENT,pin_status.eq.PENDING),and(status.eq.SENT,message_pin_status.eq.PENDING)").order("position").limit(5000);
  const targets = (open ?? []) as Row[];
  if (!targets.length) { await finishBroadcasts(db, ids); return { steps: 0 }; }
  const accountIds = [...new Set(targets.map((row) => String(row.channel_account_id)))];
  const [{ data: accounts }, { data: today }] = await Promise.all([
    db.from("channel_accounts").select("id,status,operator_enabled").in("id", accountIds),
    db.from("zalo_broadcast_targets").select("id,channel_account_id,status,done_at").in("channel_account_id", accountIds).gte("done_at", new Date(vnDayStart(now)).toISOString()).limit(20_000),
  ]);
  const healthy = new Set(((accounts ?? []) as Row[]).filter((row) => row.status === "CONNECTED" && row.operator_enabled !== false).map((row) => String(row.id)));
  const activity = new Map<string, NickActivity>();
  for (const row of (today ?? []) as Row[]) {
    const id = String(row.channel_account_id);
    const current = activity.get(id) ?? { doneToday: 0, lastAt: null, lastKey: null };
    const at = Date.parse(String(row.done_at));
    activity.set(id, { doneToday: current.doneToday + (row.status === "SENT" ? 1 : 0), lastAt: Math.max(current.lastAt ?? 0, at), lastKey: (current.lastAt ?? 0) >= at ? current.lastKey : String(row.id) });
  }
  const plan: PlanBroadcast[] = broadcasts.map((row) => ({ id: String(row.id), sendMessage: row.send_message === true, pinMessage: row.pin_message === true, pinNote: row.pin_note === true, dailyCapPerNick: Number(row.daily_cap_per_nick),
    minGapSeconds: Number(row.min_gap_seconds), maxGapSeconds: Number(row.max_gap_seconds), windowStartHour: Number(row.window_start_hour), windowEndHour: Number(row.window_end_hour) }));
  const planTargets: PlanTarget[] = targets.filter((row) => healthy.has(String(row.channel_account_id))).map((row) => ({ id: String(row.id), broadcastId: String(row.broadcast_id), accountId: String(row.channel_account_id),
    position: Number(row.position), status: String(row.status), pinStatus: String(row.pin_status), messagePinStatus: String(row.message_pin_status), attempts: Number(row.attempts), pinAttempts: Number(row.pin_attempts), messagePinAttempts: Number(row.message_pin_attempts),
    doneAt: typeof row.done_at === "string" ? row.done_at : null, updatedAt: String(row.updated_at) }));
  const steps = nextSteps(plan, planTargets, activity, now);
  for (const step of steps) {
    const broadcast = broadcasts.find((row) => row.id === step.broadcastId)!;
    const target = targets.find((row) => row.id === step.targetId)!;
    const workspaceId = String(broadcast.workspace_id);
    if (step.action === "NOTE") { await note(db, step, broadcast, target, broadcast.send_message !== true); continue; }
    if (step.action === "PIN_MESSAGE") {
      await pinMessage(db, step, broadcast, target);
      if (broadcast.pin_note === true && target.pin_status === "PENDING") await note(db, step, broadcast, target, false);
      continue;
    }
    const attempt = Number(target.attempts ?? 0) + 1;
    const { data: actionId } = await db.rpc("propose_zalo_broadcast_send_service", { p_workspace_id: workspaceId, p_target_id: step.targetId, p_attempt: attempt });
    if (typeof actionId !== "string") {
      await db.from("zalo_broadcast_targets").update({ status: "SKIPPED", done_at: new Date().toISOString(), error_code: "NOT_A_GROUP_OR_STOPPED" }).eq("id", step.targetId).eq("status", "PENDING");
      continue;
    }
    let result: { status: string; safeErrorCode?: string };
    try {
      const loaded = await loadChannelAdapterByAccountId(step.accountId);
      const registry = new ChannelAdapterRegistry();
      registry.register(loaded.adapter);
      result = await executeChannelOutboundAction(actionId, registry);
    } catch { result = { status: "UNAVAILABLE" }; }
    const at = new Date().toISOString();
    if (result.status === "SENT") {
      await db.from("zalo_broadcast_targets").update({ status: "SENT", done_at: at, attempts: attempt, error_code: null, outbound_action_id: actionId }).eq("id", step.targetId);
      if (broadcast.pin_message === true) await pinMessage(db, step, broadcast, { ...target, outbound_action_id: actionId });
      if (broadcast.pin_note === true) await note(db, step, broadcast, target, false);
    } else if (result.status === "DELIVERY_UNKNOWN") {
      await db.from("zalo_broadcast_targets").update({ status: "UNKNOWN", done_at: at, attempts: attempt, error_code: "DELIVERY_UNKNOWN" }).eq("id", step.targetId);
    } else {
      const code = result.safeErrorCode ?? result.status;
      const retry = RETRYABLE.has(code) && attempt < MAX_ATTEMPTS;
      await db.from("zalo_broadcast_targets").update(retry ? { attempts: attempt, error_code: code.slice(0, 60) } : { status: "FAILED", done_at: at, attempts: attempt, error_code: code.slice(0, 60) }).eq("id", step.targetId);
    }
  }
  await finishBroadcasts(db, ids);
  return { steps: steps.length };
}
