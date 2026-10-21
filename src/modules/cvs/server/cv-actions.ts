"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { cvContext } from "./cv-data";
import { syncHumanCvs } from "./cv-sync";

type State = { ok: boolean; message: string };
async function manager() {
  const context = await cvContext();
  return context?.canManage ? context : null;
}
const paths = () => { revalidatePath("/cvs"); revalidatePath("/cvs/settings"); };

export async function refreshCvsFromHuman(): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền CV · Cập nhật từ Human." };
  const result = await syncHumanCvs(context.workspaceId, "MANUAL", context.userId);
  paths();
  return { ok: result.ok, message: result.message };
}

export async function addCvBlock(_state: State, form: FormData): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền cài đặt CV." };
  const parsed = z.object({ blockKey: z.string().trim().regex(/^[A-Za-z0-9_-]{1,60}$/u), name: z.string().trim().max(80) }).safeParse({ blockKey: form.get("blockKey"), name: form.get("name") ?? "" });
  if (!parsed.success) return { ok: false, message: "Mã khối chỉ gồm chữ, số, _ hoặc - (ví dụ CV_GOC)." };
  const db = createPrivilegedClient();
  const { count } = await db.from("human_cv_blocks").select("block_key", { count: "exact", head: true }).eq("workspace_id", context.workspaceId);
  const { error } = await db.from("human_cv_blocks").insert({ workspace_id: context.workspaceId, block_key: parsed.data.blockKey, name: parsed.data.name || null, sort: (count ?? 0) + 1 });
  if (error) return { ok: false, message: error.code === "23505" ? "Khối này đã có." : "Chưa thêm được khối." };
  paths();
  return { ok: true, message: `Đã thêm khối ${parsed.data.blockKey}. Bấm "Cập nhật từ Human" để lấy CV của khối này.` };
}

export async function updateCvBlock(form: FormData) {
  const context = await manager();
  if (!context) return;
  const blockKey = String(form.get("blockKey") ?? "");
  if (!/^[A-Za-z0-9_-]{1,60}$/u.test(blockKey)) return;
  const db = createPrivilegedClient();
  if (form.get("intent") === "remove") await db.from("human_cv_blocks").delete().eq("workspace_id", context.workspaceId).eq("block_key", blockKey);
  else await db.from("human_cv_blocks").update({ name: String(form.get("name") ?? "").trim().slice(0, 80) || null, enabled: form.get("enabled") === "on" }).eq("workspace_id", context.workspaceId).eq("block_key", blockKey);
  paths();
}

/** Rec on Human ↔ HireX member (the same links Khách hàng uses for Sale / AM). */
export async function saveRecLinks(_state: State, form: FormData): Promise<State> {
  const context = await manager();
  if (!context) return { ok: false, message: "Bạn chưa có quyền cài đặt CV." };
  const db = createPrivilegedClient();
  const { data: members } = await db.from("profiles").select("id").eq("workspace_id", context.workspaceId);
  const memberIds = new Set((members ?? []).map((row) => String(row.id)));
  let changed = 0;
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("link:") || typeof value !== "string") continue;
    const humanId = key.slice(5).slice(0, 100);
    const { error } = await db.from("human_user_links").update({ profile_id: value && memberIds.has(value) ? value : null, updated_at: new Date().toISOString() }).eq("workspace_id", context.workspaceId).eq("human_user_id", humanId);
    if (!error) changed += 1;
  }
  paths(); revalidatePath("/customers"); revalidatePath("/customers/settings");
  return { ok: true, message: `Đã lưu ${changed} liên kết Rec trên Human ↔ HireX.` };
}
