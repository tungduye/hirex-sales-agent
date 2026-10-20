"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { cleanFilterQuery, isSavedFilterScope, isSavedFilterView, MAX_SAVED_FILTERS, type SavedFilter } from "../core/saved-filters";

/** The signed-in member's saved Suối Nguồn filters (row security keeps them private). */
export async function listSavedFilters(): Promise<SavedFilter[]> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("inbox_saved_filters").select("id,name,query,scope,view").eq("workspace_id", account.workspaceId).eq("profile_id", account.userId).order("sort").order("created_at");
  return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string, query: (row.query as string) ?? "", scope: isSavedFilterScope(row.scope) ? row.scope : null, view: isSavedFilterView(row.view) ? row.view : null }));
}

export async function saveFilter(input: { name: string; query: string; scope: string | null; view: string | null }): Promise<{ ok: true; filters: SavedFilter[] } | { ok: false; message: string }> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { ok: false, message: "Phiên đăng nhập đã hết, hãy tải lại trang." };
  const name = z.string().trim().min(1).max(60).safeParse(input.name);
  if (!name.success) return { ok: false, message: "Tên bộ lọc cần từ 1 đến 60 ký tự." };
  const supabase = await createClient();
  const { count } = await supabase.from("inbox_saved_filters").select("id", { count: "exact", head: true }).eq("workspace_id", account.workspaceId).eq("profile_id", account.userId);
  const row = { workspace_id: account.workspaceId, profile_id: account.userId, name: name.data, query: cleanFilterQuery(input.query ?? ""), scope: isSavedFilterScope(input.scope) ? input.scope : null, view: isSavedFilterView(input.view) ? input.view : null };
  // Same name again = update that filter, so "Lưu" twice never piles up copies.
  const { data: existing } = await supabase.from("inbox_saved_filters").select("id").eq("workspace_id", account.workspaceId).eq("profile_id", account.userId).eq("name", name.data).maybeSingle();
  if (!existing && (count ?? 0) >= MAX_SAVED_FILTERS) return { ok: false, message: `Tối đa ${MAX_SAVED_FILTERS} bộ lọc, hãy xóa bớt bộ lọc cũ.` };
  const { error } = existing
    ? await supabase.from("inbox_saved_filters").update({ query: row.query, scope: row.scope, view: row.view }).eq("id", existing.id)
    : await supabase.from("inbox_saved_filters").insert({ ...row, sort: count ?? 0 });
  if (error) return { ok: false, message: "Chưa lưu được bộ lọc, thử lại sau." };
  return { ok: true, filters: await listSavedFilters() };
}

export async function deleteSavedFilter(id: string): Promise<SavedFilter[]> {
  const account = await getAccountContext();
  if (!account?.workspaceId || !z.uuid().safeParse(id).success) return listSavedFilters();
  const supabase = await createClient();
  await supabase.from("inbox_saved_filters").delete().eq("id", id).eq("profile_id", account.userId);
  return listSavedFilters();
}
