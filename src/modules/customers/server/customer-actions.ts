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
