import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { scopeFromCookie } from "@/modules/inbox/core/inbox-scope";
import { getOmnichannelInboxData } from "./get-omnichannel-inbox-data";
import { inboxFiltersFrom } from "./inbox-request-filters";

export const BULK_ACTIONS = ["TAG_ADD", "TAG_REMOVE", "MARK_READ", "MOVE_OTHER", "MOVE_PRIMARY", "ASSIGN"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const BULK_LIMIT = 5000;

export const bulkRequestSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  tagIds: z.array(z.uuid()).max(20).optional(),
  assigneeId: z.uuid().nullable().optional(),
  /** Picked rows (every copy of a merged Zalo group is listed). */
  conversationIds: z.array(z.uuid()).max(BULK_LIMIT).optional(),
  /** Or: every conversation the list filters select (the query string of the list, tab and search included). */
  filterQuery: z.string().max(4000).optional(),
  /** Count only, change nothing (for the confirmation). */
  dryRun: z.boolean().optional(),
});
export type BulkRequest = z.infer<typeof bulkRequestSchema>;

export type BulkResult =
  | { ok: true; dryRun: true; count: number; more: boolean }
  | { ok: true; dryRun: false; operationId: string; affected: number; skipped: number; requested: number }
  | { ok: false; status: number; error: string };

const ERRORS: Record<string, [number, string]> = {
  FORBIDDEN: [403, "Bạn không có quyền cập nhật hội thoại (Suối Nguồn · Cập nhật)."],
  TOO_MANY: [400, `Mỗi lần làm tối đa ${BULK_LIMIT.toLocaleString("vi-VN")} hội thoại. Hãy lọc hẹp hơn.`],
  INVALID_TAG: [400, "Nhãn không còn tồn tại. Hãy tải lại trang."],
  INVALID_ASSIGNEE: [400, "Không tìm thấy người được giao."],
  INVALID_ACTION: [400, "Thao tác không hợp lệ."],
  NOT_FOUND: [404, "Không tìm thấy thao tác này (chỉ người làm mới hoàn tác được)."],
  ALREADY_UNDONE: [409, "Thao tác này đã được hoàn tác rồi."],
  TOO_LATE: [409, "Đã quá 10 phút, không hoàn tác được nữa."],
};
function failure(message: string | undefined): BulkResult & { ok: false } {
  const known = Object.keys(ERRORS).find((key) => message?.includes(key));
  const [status, error] = known ? ERRORS[known] : [500, "Chưa làm được, vui lòng thử lại."];
  return { ok: false, status, error };
}

/** Runs one bulk action for the signed-in member (permission and nick scope are checked again in the database). */
export async function runBulkAction(input: BulkRequest, cookieHeader: string | null, source: "INBOX" | "ASSISTANT" = "INBOX"): Promise<BulkResult> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { ok: false, status: 401, error: "Phiên đăng nhập đã hết, hãy đăng nhập lại." };
  if (!account.permissions.includes("inbox.update")) return failure("FORBIDDEN");
  let ids = [...new Set(input.conversationIds ?? [])];
  if (input.filterQuery !== undefined) {
    const data = await getOmnichannelInboxData({ ...inboxFiltersFrom(new URLSearchParams(input.filterQuery)), scope: scopeFromCookie(cookieHeader), mode: "ids" });
    if (data.error) return { ok: false, status: 400, error: data.error };
    ids = data.matchingIds ?? [];
    if (input.dryRun) return { ok: true, dryRun: true, count: Math.min(ids.length, BULK_LIMIT), more: ids.length > BULK_LIMIT };
    if (ids.length > BULK_LIMIT) return failure("TOO_MANY");
  } else if (input.dryRun) return { ok: true, dryRun: true, count: ids.length, more: false };
  if (ids.length === 0) return { ok: false, status: 400, error: "Chưa có hội thoại nào được chọn." };
  if ((input.action === "TAG_ADD" || input.action === "TAG_REMOVE") && !input.tagIds?.length) return { ok: false, status: 400, error: "Hãy chọn ít nhất một nhãn." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inbox_bulk_apply", {
    p_conversation_ids: ids, p_action: input.action, p_tag_ids: input.tagIds ?? null,
    p_assignee_id: input.action === "ASSIGN" ? input.assigneeId ?? null : null, p_source: source,
  });
  if (error) return failure(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as { operation_id?: unknown; affected?: unknown; skipped?: unknown } | null;
  if (!row || typeof row.operation_id !== "string") return failure(undefined);
  return { ok: true, dryRun: false, operationId: row.operation_id, affected: Number(row.affected) || 0, skipped: Number(row.skipped) || 0, requested: ids.length };
}

export async function undoBulkAction(operationId: string): Promise<{ ok: true; restored: number } | { ok: false; status: number; error: string }> {
  const account = await getAccountContext();
  if (!account?.workspaceId) return { ok: false, status: 401, error: "Phiên đăng nhập đã hết, hãy đăng nhập lại." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inbox_bulk_undo", { p_operation_id: operationId });
  if (error) return failure(error.message);
  return { ok: true, restored: Number(data) || 0 };
}
