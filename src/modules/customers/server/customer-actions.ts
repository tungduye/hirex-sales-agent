"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { customerContext } from "./customer-data";
import { syncHumanPartners } from "./partner-sync";

type State = { ok: boolean; message: string };
async function manager() {
  const context = await customerContext();
  return context?.canManage ? context : null;
}

export async function refreshCustomersFromHuman(): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền Khách hàng · Cập nhật từ Human." };
  const result = await syncHumanPartners(context.workspaceId, "MANUAL", context.userId);
  revalidatePath("/customers");
  return { ok: result.ok, message: result.message };
}

export async function addCustomerBlock(_state: State, form: FormData): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền cài đặt Khách hàng." };
  const parsed = z.object({ blockId: z.coerce.number().int().positive().max(2_000_000_000), name: z.string().trim().max(80) }).safeParse({ blockId: form.get("blockId"), name: form.get("name") ?? "" });
  if (!parsed.success) return { ok: false, message: "Mã khối phải là số." };
  const db = createPrivilegedClient();
  const { count } = await db.from("human_partner_blocks").select("block_id", { count: "exact", head: true }).eq("workspace_id", context.workspaceId);
  const { error } = await db.from("human_partner_blocks").insert({ workspace_id: context.workspaceId, block_id: parsed.data.blockId, name: parsed.data.name || null, sort: (count ?? 0) + 1 });
  if (error) return { ok: false, message: error.code === "23505" ? "Khối này đã có." : "Chưa thêm được khối." };
  revalidatePath("/customers"); revalidatePath("/customers/settings");
  return { ok: true, message: `Đã thêm khối ${parsed.data.blockId}. Bấm "Cập nhật từ Human" để lấy khách của khối này.` };
}

export async function updateCustomerBlock(form: FormData) {
  const context = await manager();
  if (!context) return;
  const blockId = Number(form.get("blockId"));
  if (!Number.isSafeInteger(blockId)) return;
  const db = createPrivilegedClient();
  if (form.get("intent") === "remove") await db.from("human_partner_blocks").delete().eq("workspace_id", context.workspaceId).eq("block_id", blockId);
  else await db.from("human_partner_blocks").update({ name: String(form.get("name") ?? "").trim().slice(0, 80) || null, enabled: form.get("enabled") === "on" }).eq("workspace_id", context.workspaceId).eq("block_id", blockId);
  revalidatePath("/customers"); revalidatePath("/customers/settings");
}

export async function saveHumanUserLinks(_state: State, form: FormData): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền cài đặt Khách hàng." };
  const db = createPrivilegedClient();
  const { data: members } = await db.from("profiles").select("id").eq("workspace_id", context.workspaceId);
  const memberIds = new Set((members ?? []).map((row) => String(row.id)));
  let changed = 0;
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("link:") || typeof value !== "string") continue;
    const humanId = key.slice(5).slice(0, 100);
    const profileId = value && memberIds.has(value) ? value : null;
    const { error } = await db.from("human_user_links").update({ profile_id: profileId, updated_at: new Date().toISOString() }).eq("workspace_id", context.workspaceId).eq("human_user_id", humanId);
    if (!error) changed += 1;
  }
  revalidatePath("/customers"); revalidatePath("/customers/settings");
  return { ok: true, message: `Đã lưu ${changed} liên kết người Human ↔ HireX.` };
}

/** "Bộ mã" pasted from Human (rows of Tên · MasterId · Loại, separated by tabs): saved, then used on the next update. */
export async function importHumanCodes(_state: State, form: FormData): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền cài đặt Khách hàng." };
  const text = String(form.get("codes") ?? "").slice(0, 500_000);
  const rows = new Map<number, { name: string; kind: string | null }>();
  for (const line of text.split(/\r?\n/u)) {
    const cells = line.split("\t").map((cell) => cell.trim());
    const index = cells.findIndex((cell, position) => position > 0 && /^\d{1,12}$/u.test(cell) && cells.slice(0, position).some(Boolean));
    if (index < 0) continue;
    const name = cells.slice(0, index).filter(Boolean).at(-1);
    if (!name) continue;
    rows.set(Number(cells[index]), { name: name.slice(0, 200), kind: cells[index + 1]?.slice(0, 100) || null });
  }
  if (!rows.size) return { ok: false, message: "Không đọc được dòng nào. Dán nguyên bảng từ Human (cột Tên, MasterId, Loại)." };
  const db = createPrivilegedClient();
  const values = [...rows].map(([masterId, row]) => ({ workspace_id: context.workspaceId, master_id: masterId, name: row.name, kind: row.kind }));
  for (let offset = 0; offset < values.length; offset += 500) {
    const { error } = await db.from("human_master_codes").upsert(values.slice(offset, offset + 500), { onConflict: "workspace_id,master_id" });
    if (error) return { ok: false, message: "Chưa lưu được bộ mã." };
  }
  revalidatePath("/customers/settings");
  return { ok: true, message: `Đã lưu ${rows.size} mã. Bấm "Cập nhật từ Human" để đổi tên trên danh sách.` };
}

/** Daily Tình trạng CV pins: on/off and time. Whoever switches it on approves the sends (needs Gửi hàng loạt Zalo too). */
export async function saveCvPinSettings(_state: State, form: FormData): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền cài đặt Khách hàng." };
  const enabled = form.get("enabled") === "on";
  if (enabled && !context.permissions.includes("broadcasts.manage")) return { ok: false, message: "Cần thêm quyền \"Gửi hàng loạt Zalo · Tạo và gửi\" để bật lịch ghim." };
  const [hour, minute] = String(form.get("time") ?? "08:30").split(":").map(Number);
  if (!Number.isInteger(hour) || hour < 8 || hour > 20 || !Number.isInteger(minute) || minute < 0 || minute > 59) return { ok: false, message: "Giờ ghim phải trong 08:00–20:59." };
  const db = createPrivilegedClient();
  const { error } = await db.from("human_cv_pin_settings").upsert({ workspace_id: context.workspaceId, enabled, run_hour: hour, run_minute: minute, ...(enabled ? { enabled_by: context.userId } : {}), updated_at: new Date().toISOString() }, { onConflict: "workspace_id" });
  if (error) return { ok: false, message: "Chưa lưu được." };
  revalidatePath("/customers/settings");
  return { ok: true, message: enabled ? `Đã bật: mỗi ngày ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} Soda ghim Tình trạng CV vào các nhóm đã duyệt (chỉ nhóm có thay đổi).` : "Đã tắt lịch ghim." };
}

/** Run today's pins now (same rules: approved groups, changed messages only, sent 8:00–21:00). */
export async function runCvPinsNow(): Promise<State> {
  const context = await manager();
  if (!context || !context.permissions.includes("broadcasts.manage")) return { ok: false, message: "Cần quyền Khách hàng · Cài đặt và Gửi hàng loạt Zalo · Tạo và gửi." };
  const db = createPrivilegedClient();
  const { data: settings } = await db.from("human_cv_pin_settings").select("enabled_by").eq("workspace_id", context.workspaceId).maybeSingle();
  if (!settings?.enabled_by) await db.from("human_cv_pin_settings").upsert({ workspace_id: context.workspaceId, enabled: false, enabled_by: context.userId }, { onConflict: "workspace_id" });
  const { runCvPins } = await import("./cv-pins");
  const result = await runCvPins(context.workspaceId);
  revalidatePath("/customers/settings"); revalidatePath("/broadcasts");
  return { ok: result.ok, message: result.message };
}

/** Find group suggestions again now (also done after each update from Human). */
export async function refreshGroupSuggestions(): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền cài đặt Khách hàng." };
  const { suggestPartnerGroups } = await import("./cv-pins");
  const count = await suggestPartnerGroups(context.workspaceId);
  revalidatePath("/customers/settings"); revalidatePath("/customers");
  return { ok: true, message: count ? `Có thêm ${count} gợi ý ghép nhóm.` : "Không có gợi ý mới." };
}

/** Confirm or reject "this Zalo group is this company's". An admin of Khách hàng, or the company's Sale / AM. */
export async function decidePartnerGroup(form: FormData) {
  const context = await customerContext();
  if (!context) return;
  const groupId = String(form.get("groupId") ?? "").slice(0, 512);
  // A company picked by hand in the list ("Tên công ty #12345") or the suggested one.
  const picked = /#(\d{1,12})\s*$/u.exec(String(form.get("partnerPick") ?? ""))?.[1];
  const partnerId = Number(picked ?? form.get("partnerId"));
  const decision = form.get("decision") === "CONFIRMED" ? "CONFIRMED" : "REJECTED";
  if (!groupId || !Number.isSafeInteger(partnerId)) return;
  const db = createPrivilegedClient();
  if (!context.canManage) {
    const [{ data: partner }, { data: links }] = await Promise.all([
      db.from("human_partners").select("sale_human_id,am_human_id,am2_human_id").eq("workspace_id", context.workspaceId).eq("partner_id", partnerId).maybeSingle(),
      db.from("human_user_links").select("human_user_id").eq("workspace_id", context.workspaceId).eq("profile_id", context.userId),
    ]);
    const mine = new Set((links ?? []).map((row) => String(row.human_user_id)));
    if (!partner || ![partner.sale_human_id, partner.am_human_id, partner.am2_human_id].some((id) => id && mine.has(String(id)))) return;
  }
  const { data: existing } = await db.from("human_partner_groups").select("group_name").eq("workspace_id", context.workspaceId).eq("group_id", groupId).limit(1).maybeSingle();
  await db.from("human_partner_groups").upsert({ workspace_id: context.workspaceId, group_id: groupId, partner_id: partnerId, group_name: existing?.group_name ?? (String(form.get("groupName") ?? "").slice(0, 300) || null),
    status: decision, decided_by: context.userId, decided_at: new Date().toISOString() }, { onConflict: "workspace_id,group_id,partner_id" });
  // One company per group: confirming this one sets the other suggestions for the group aside.
  if (decision === "CONFIRMED") await db.from("human_partner_groups").update({ status: "REJECTED", decided_by: context.userId, decided_at: new Date().toISOString() })
    .eq("workspace_id", context.workspaceId).eq("group_id", groupId).neq("partner_id", partnerId).neq("status", "REJECTED");
  revalidatePath("/customers/settings"); revalidatePath("/customers");
}
