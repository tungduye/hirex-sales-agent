"use server";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";

export interface BatchResult {
  status: "PENDING" | "COMPLETED" | "PARTIAL" | "FAILED";
  quantity: number; savedCount: number; rejectedCount: number; errorCode: string | null;
  items: Array<{ id: string; code: string; title: string; body: string }>;
}

/** A batch the member started, with the content it saved (the "Tạo content" screen polls this). */
export async function getContentBatchResult(batchId: string): Promise<BatchResult | null> {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return null;
  const account = await getAccountContext();
  if (!account?.workspaceId) return null;
  const supabase = await createClient();
  const { data: batch } = await supabase.from("content_batches").select("status, quantity, saved_count, rejected_count, error_code, created_by")
    .eq("workspace_id", account.workspaceId).eq("id", batchId).maybeSingle();
  if (!batch || batch.created_by !== account.userId) return null;
  const { data: items } = batch.status === "PENDING" ? { data: [] } : await supabase.from("content_items").select("id, code, title, body")
    .eq("workspace_id", account.workspaceId).eq("batch_id", batchId).order("created_at").limit(20);
  return { status: batch.status as BatchResult["status"], quantity: batch.quantity, savedCount: batch.saved_count, rejectedCount: batch.rejected_count, errorCode: batch.error_code,
    items: ((items ?? []) as BatchResult["items"]) };
}
