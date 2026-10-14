import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { buildAlerts, diffAlerts, type AlertMember, type OpenAlert } from "@/modules/assistant/core/alert-rules";
import { queryWaitingConversations } from "@/modules/assistant/server/assistant-tool-runner";
import { getCampaignWorkerHealth } from "@/modules/campaigns/server/campaign-worker-health";

// Background scan for Trợ lý HireX alerts (phase 3, step 2). Runs from the alerts worker every few
// minutes with the server key: it reads each workspace's state, works out who must be told what
// (alert-rules.ts, using each member's role permissions and channel-account access) and syncs the
// assistant_alerts table. It only reads business data; the only thing it writes is alerts.

function waitHours() {
  const value = Number.parseFloat(process.env.ASSISTANT_ALERT_WAIT_HOURS ?? "");
  return Number.isFinite(value) && value >= 1 && value <= 48 ? value : 4;
}

async function loadMembers(db: ReturnType<typeof createPrivilegedClient>, workspaceId: string): Promise<AlertMember[]> {
  const [profiles, roles, permissions, access] = await Promise.all([
    db.from("profiles").select("id,role_id,all_channel_accounts").eq("workspace_id", workspaceId),
    db.from("workspace_roles").select("id,name,is_system").eq("workspace_id", workspaceId),
    db.from("workspace_role_permissions").select("role_id,permission_key").eq("workspace_id", workspaceId),
    db.from("profile_channel_account_access").select("profile_id,channel_account_id").eq("workspace_id", workspaceId),
  ]);
  if (profiles.error || roles.error || permissions.error || access.error) throw new Error("MEMBERS_UNAVAILABLE");
  const adminRoles = new Set((roles.data ?? []).filter((role) => role.is_system && role.name === "Quản trị viên").map((role) => role.id));
  const byRole = new Map<string, string[]>();
  for (const row of permissions.data ?? []) byRole.set(row.role_id, [...(byRole.get(row.role_id) ?? []), row.permission_key]);
  const channelsOf = new Map<string, string[]>();
  for (const row of access.data ?? []) channelsOf.set(row.profile_id, [...(channelsOf.get(row.profile_id) ?? []), row.channel_account_id]);
  return (profiles.data ?? []).filter((profile) => profile.role_id).map((profile) => {
    const rolePermissions = byRole.get(profile.role_id!) ?? [];
    // Same test as isWorkspaceAdmin(): the system administrator role with role and settings rights.
    const isAdmin = adminRoles.has(profile.role_id!) && rolePermissions.includes("roles.manage") && rolePermissions.includes("settings.view");
    return { id: profile.id, isAdmin, permissions: rolePermissions, allChannels: Boolean(profile.all_channel_accounts), channelIds: channelsOf.get(profile.id) ?? [] };
  });
}

export async function scanWorkspaceAlerts(workspaceId: string) {
  const db = createPrivilegedClient();
  const hours = waitHours();
  const [members, channels, running, worker, waiting] = await Promise.all([
    loadMembers(db, workspaceId),
    db.from("channel_accounts").select("id,channel_type,display_name,status,operator_enabled,provider_health_status,provider_health_reason_code,last_error_code").eq("workspace_id", workspaceId).is("deleted_at", null),
    db.from("email_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "RUNNING").is("archived_at", null),
    getCampaignWorkerHealth(),
    queryWaitingConversations(db, workspaceId, hours, null),
  ]);
  if (channels.error) throw new Error("CHANNELS_UNAVAILABLE");
  if ("loi" in waiting) throw new Error("INBOX_UNAVAILABLE");

  const desired = buildAlerts({
    waitHours: hours,
    members,
    channels: (channels.data ?? []).map((row) => ({ id: row.id, type: row.channel_type, name: row.display_name, status: row.status, operatorEnabled: row.operator_enabled, health: row.provider_health_status, healthReason: row.provider_health_reason_code, lastError: row.last_error_code })),
    emailWorker: running.error ? null : { state: worker.state, runningCampaigns: running.count ?? 0 },
    waiting: waiting.rows.map((row) => ({ id: row.id, channelAccountId: row.channelAccountId, channel: row.channel, name: row.name, account: row.account, hours: row.hours, group: row.group, automated: row.automated, assignedTo: row.assignedTo, lastInboundId: row.lastMessageId })),
  });

  const { data: openRows, error: openError } = await db.from("assistant_alerts").select("id,user_id,dedupe_key").eq("workspace_id", workspaceId).is("resolved_at", null).limit(5000);
  if (openError) throw new Error("ALERTS_UNAVAILABLE");
  const open: OpenAlert[] = (openRows ?? []).map((row) => ({ id: row.id, userId: row.user_id, dedupeKey: row.dedupe_key }));
  const { toCreate, toResolve } = diffAlerts(desired, open);

  let created = 0;
  const rows = toCreate.map((alert) => ({ workspace_id: workspaceId, user_id: alert.userId, kind: alert.kind, dedupe_key: alert.dedupeKey, severity: alert.severity, title: alert.title.slice(0, 300), body: alert.body?.slice(0, 1000) ?? null, link: alert.link }));
  for (let offset = 0; offset < rows.length; offset += 200) {
    const batch = rows.slice(offset, offset + 200);
    const { error } = await db.from("assistant_alerts").insert(batch);
    if (!error) { created += batch.length; continue; }
    // A concurrent scan may have created some of them (unique open alert per problem): insert one by one.
    for (const row of batch) if (!(await db.from("assistant_alerts").insert(row)).error) created += 1;
  }
  for (let offset = 0; offset < toResolve.length; offset += 200) {
    await db.from("assistant_alerts").update({ resolved_at: new Date().toISOString() }).in("id", toResolve.slice(offset, offset + 200)).is("resolved_at", null);
  }
  return { created, resolved: toResolve.length, open: open.length - toResolve.length + created };
}

/** Scans every workspace; one failing workspace does not stop the others. */
export async function scanAllAlerts() {
  const { data, error } = await createPrivilegedClient().from("workspaces").select("id");
  if (error) throw new Error("WORKSPACES_UNAVAILABLE");
  const results: Record<string, unknown> = {};
  for (const workspace of data ?? []) {
    try { results[workspace.id] = await scanWorkspaceAlerts(workspace.id); }
    catch (caught) { results[workspace.id] = { error: caught instanceof Error ? caught.message : "SCAN_FAILED" }; }
  }
  return results;
}
