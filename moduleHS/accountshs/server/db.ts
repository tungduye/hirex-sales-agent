import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { hasPermission, isWorkspaceAdmin } from "@/modules/access/server/access-control";
import type { Device, Epoch, Id } from "../types";

/** Bảng ahs_* chỉ server đọc được (RLS khoá anon/authenticated) → luôn dùng client đặc quyền, sau khi đã kiểm quyền. */
export const T = {
  depts: "ahs_depts", owners: "ahs_owners", tabs: "ahs_tabs", fields: "ahs_fields", statuses: "ahs_statuses", devices: "ahs_devices",
  accounts: "ahs_accounts", links: "ahs_links", settings: "ahs_settings", logs: "ahs_logs", tomb: "ahs_tomb", acc_hist: "ahs_acc_hist",
  cyv_checks: "ahs_cyv_checks", ver: "ahs_ver",
} as const;
export type TableKey = keyof typeof T;

let cached: ReturnType<typeof createPrivilegedClient> | null = null;
export function sb() { return (cached ??= createPrivilegedClient()); }

export const now = (): Epoch => Date.now() / 1000;
export const j = (o: unknown) => JSON.stringify(o);

export class HsError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
/** Python: class Conflict(ValueError) → HTTP 409, client tải lại toàn bộ. */
export class Conflict extends HsError { constructor(message: string) { super(message, 409); } }

/** Chạy truy vấn PostgREST/RPC/Storage, ném HsError (thông điệp tiếng Việt khi có thể). */
export async function run<R = unknown>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<R> {
  const { data, error } = await query;
  if (error) throw new HsError(explain(error.message), 500);
  return data as R;
}

/** Lỗi do DB chưa có migration 121 (hàm/bảng mới chưa tạo) — bản chạy local xem trước khi deploy vẫn dùng được phần còn lại. */
const MISSING = /PGRST20[25]|Could not find the (function|table)|(function|relation) [^ ]*ahs_\w+[^ ]* does not exist/i;
export const isMissing = (e: unknown) => e instanceof Error && MISSING.test(e.message);
export class NeedMigration extends HsError { constructor() { super("Chức năng này cần migration 121_hs_accountshs.sql — sẽ có sau khi deploy.", 503); } }
function explain(m: string) {
  if (MISSING.test(m)) return "Chức năng này cần migration 121_hs_accountshs.sql — sẽ có sau khi deploy. (" + m + ")";
  return m;
}
/** Chạy truy vấn; nếu DB chưa có migration thì trả `fallback` (hàm) thay vì lỗi. */
export async function orMissing<R>(p: Promise<R>, fallback: () => R | Promise<R>): Promise<R> {
  try { return await p; } catch (e) { if (isMissing(e)) return fallback(); throw e; }
}
/** ahs_ver.n + 1 — để bộ đệm (Cú vọ, client) biết có thay đổi. Có migration thì trigger tự tăng; tăng thêm cũng vô hại. */
export async function bumpVer() {
  const r = await run<{ n: number } | null>(sb().from(T.ver).select("n").eq("id", 1).maybeSingle()).catch(() => null);
  if (r) await run(sb().from(T.ver).update({ n: Number(r.n) + 1 }).eq("id", 1)).catch(() => undefined);
}

/** select * from <t> [where] order by pos,id — thứ tự chuẩn của mọi bảng meta. */
export async function allOrdered<R>(t: TableKey, order: "pos" | "id" = "pos"): Promise<R[]> {
  let q = sb().from(T[t]).select("*");
  q = order === "pos" ? q.order("pos").order("id") : q.order("id");
  return run<R[]>(q);
}

export async function getSetting(k: string, d = ""): Promise<string> {
  const r = await run<{ v: string | null } | null>(sb().from(T.settings).select("v").eq("k", k).maybeSingle());
  return r?.v ?? d;
}
export async function setSetting(k: string, v: string | number) {
  await run(sb().from(T.settings).upsert({ k, v: String(v) }, { onConflict: "k" }));
}
export async function getJsonSetting<R>(k: string, d: R): Promise<R> {
  try { const v = await getSetting(k, ""); return v ? (JSON.parse(v) as R) : d; } catch { return d; }
}

export function parseDevice(d: Omit<Device, "caps"> & { caps: string | Record<string, number> | null }): Device {
  let caps: Record<string, number> = {};
  if (d.caps && typeof d.caps === "object") caps = d.caps;
  else { try { caps = JSON.parse(d.caps || "{}"); } catch { caps = {}; } }
  return { ...d, caps };
}

/** Nhật ký (ahs_logs) — HireX ghi thêm ai làm. */
export async function log(act: string, n = 1, detail = "") {
  const who = await getAccountContext().catch(() => null);
  await run(sb().from(T.logs).insert({ ts: now(), act, n, detail: String(detail).slice(0, 400), user_id: who?.userId ?? null, user_name: who?.fullName ?? who?.email ?? null }));
}

/** Quyền: dùng đúng quyền có sẵn của HireX (không thêm khoá vào permission-catalog — chỉ code trong moduleHS):
 *  view, edit = "Tài khoản · Xem" (accounts.view) — như bản Python: ai mở được là thao tác được;
 *  manage (Tùy chỉnh, sao lưu/khôi phục, Cú vọ cấu hình, CRM) = Quản trị viên workspace. */
export type Level = "view" | "edit" | "manage";
export async function requireHs(level: Level = "view") {
  const account = await getAccountContext();
  if (!account?.workspaceId) throw new HsError("Chưa đăng nhập", 401);
  if (!account.permissions.includes("accounts.view")) throw new HsError("Bạn chưa được cấp quyền mục Tài khoản", 403);
  if (level === "manage" && !(await isWorkspaceAdmin())) throw new HsError("Chỉ Quản trị viên được dùng chức năng này", 403);
  return account;
}
export { hasPermission };

export const toIds = (xs: unknown): Id[] => (Array.isArray(xs) ? xs : []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
export function chunks<X>(xs: X[], n: number): X[][] { const out: X[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; }
