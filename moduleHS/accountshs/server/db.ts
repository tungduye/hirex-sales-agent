import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
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

/** Lỗi do DB chưa chạy sql/hs_accountshs.sql (hàm/bảng mới chưa tạo) — phần còn lại vẫn dùng được (có đường dự phòng). */
const MISSING = /PGRST20[25]|Could not find the (function|table)|(function|relation) [^ ]*ahs_\w+[^ ]* does not exist/i;
export const isMissing = (e: unknown) => e instanceof Error && MISSING.test(e.message);
export class NeedMigration extends HsError { constructor() { super("Chức năng này cần cập nhật DB: chạy moduleHS/accountshs/sql/hs_accountshs.sql trên Supabase.", 503); } }
function explain(m: string) {
  if (MISSING.test(m)) return "Chức năng này cần cập nhật DB: chạy moduleHS/accountshs/sql/hs_accountshs.sql trên Supabase. (" + m + ")";
  return m;
}
/** Chạy truy vấn; nếu DB chưa có migration thì trả `fallback` (hàm) thay vì lỗi. */
export async function orMissing<R>(p: Promise<R>, fallback: () => R | Promise<R>): Promise<R> {
  try { return await p; } catch (e) { if (isMissing(e)) return fallback(); throw e; }
}
/** Lệnh ghi đang chạy trong tiến trình này (thời điểm bắt đầu). Dòng ghi có `updated` = lúc bắt đầu nhưng chỉ thấy được khi xong
 *  (sửa hàng loạt có thể vài giây) → mốc `ts` trả cho trình duyệt / dòng thời gian thực không bao giờ vượt quá lệnh ghi còn dở,
 *  lần hỏi sau vẫn lấy lại các dòng đó (không bao giờ sót; trùng thì trình duyệt gộp). */
const INFLIGHT = new Map<number, Epoch>();
let inflightN = 0;
export function writeBegin(): number { const k = ++inflightN; INFLIGHT.set(k, now()); return k; }
export function writeEnd(k: number) { INFLIGHT.delete(k); }
export function safeTs(t: Epoch = now()): Epoch { let m = t; for (const v of INFLIGHT.values()) if (v < m) m = v; return m; }
/** ahs_ver.n + 1 — để bộ đệm (Cú vọ, client) biết có thay đổi. Có migration thì trigger tự tăng; tăng thêm cũng vô hại. */
/** feed.ts đăng ký vào đây: ghi xong là đẩy thay đổi cho mọi trình duyệt ngay, không chờ nhịp hỏi. */
export const BUMP: { fn: null | (() => void) } = { fn: null };
export async function bumpVer() {
  const r = await run<{ n: number } | null>(sb().from(T.ver).select("n").eq("id", 1).maybeSingle()).catch(() => null);
  if (r) await run(sb().from(T.ver).update({ n: Number(r.n) + 1 }).eq("id", 1)).catch(() => undefined);
  BUMP.fn?.();
}

/** PostgREST trả tối đa max_rows (supabase/config.toml: 1000) dòng mỗi lần → đọc hết theo trang. `q` phải sắp theo khoá duy nhất; `max` = giới hạn tổng. */
export const PAGE = 1000;
const WAVE = 4;
export async function pages<R>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, max = Infinity, wave = WAVE): Promise<R[]> {
  // trang đầu đọc 1 mình (bảng nhỏ chỉ tốn 1 lượt); còn nữa thì đọc `wave` trang song song mỗi đợt (mặc định 4), giữ đúng thứ tự
  const n0 = Math.min(PAGE, max), out = await run<R[]>(q(0, n0 - 1));
  if (out.length < n0) return out;
  for (let from = PAGE; from < max; from += PAGE * wave) {
    const part: Array<Promise<{ rows: R[]; n: number }>> = [];
    for (let k = 0; k < wave && from + k * PAGE < max; k++) {
      const f = from + k * PAGE, n = Math.min(PAGE, max - f);
      part.push(run<R[]>(q(f, f + n - 1)).then((rows) => ({ rows, n })));
    }
    for (const { rows, n } of await Promise.all(part)) { out.push(...rows); if (rows.length < n) return out; }
  }
  return out;
}

/** select * from <t> order by pos,id — thứ tự chuẩn của mọi bảng meta. */
export function allOrdered<R>(t: TableKey, order: "pos" | "id" = "pos"): Promise<R[]> {
  return pages<R>((a, b) => { const q = sb().from(T[t]).select("*"); return (order === "pos" ? q.order("pos").order("id") : q.order("id")).range(a, b); });
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

/** ahs_logs có cột user_id/user_name chưa (migration HireX). Bảng của bản Python chưa có → ghi như Python.
 *  Hỏi lại sau 10 phút để tự bật khi migration đã chạy. */
let logUser: { ok: boolean; at: number } | null = null;
export async function hasLogUser(): Promise<boolean> {
  if (logUser && Date.now() - logUser.at < 600_000) return logUser.ok;
  const { error } = await sb().from(T.logs).select("user_id,user_name").limit(1);
  logUser = { ok: !error, at: Date.now() };
  return logUser.ok;
}
/** Nhật ký (ahs_logs) — HireX ghi thêm ai làm (khi DB đã có cột). */
export async function log(act: string, n = 1, detail = "") {
  const row: Record<string, unknown> = { ts: now(), act, n, detail: String(detail).slice(0, 400) };
  if (await hasLogUser()) {
    const who = await accountCtx().catch(() => null);
    row.user_id = who?.userId ?? null; row.user_name = who?.fullName ?? who?.email ?? null;
  }
  await run(sb().from(T.logs).insert(row));
}

/** Bucket Storage của module: bản Python lưu file ở ổ đĩa nên DB cũ chưa có bucket → tự tạo (private) lần đầu. */
export const BUCKET = "hs-accountshs";
let bucketOk: Promise<void> | null = null;
export function ensureBucket() {
  return (bucketOk ??= (async () => {
    const st = sb().storage;
    const { error } = await st.getBucket(BUCKET);
    if (!error) return;
    let c = await st.createBucket(BUCKET, { public: false, fileSizeLimit: 104857600 });
    if (c.error && /size/i.test(c.error.message)) c = await st.createBucket(BUCKET, { public: false });   // gói Supabase giới hạn thấp hơn 100 MB → theo giới hạn chung
    if (c.error && !/exist|duplicate/i.test(c.error.message)) throw new HsError("Không tạo được bucket Storage " + BUCKET + ": " + c.error.message, 500);
  })().catch((e) => { bucketOk = null; throw e; }));
}

/** Quyền: dùng đúng quyền có sẵn của HireX (không thêm khoá vào permission-catalog — chỉ code trong moduleHS):
 *  view, edit = "Tài khoản · Xem" (accounts.view) — như bản Python: ai mở được là thao tác được;
 *  manage (Tùy chỉnh, sao lưu/khôi phục, Cú vọ cấu hình, CRM) = Quản trị viên workspace. */
export type Level = "view" | "edit" | "manage";
/** Đăng nhập + quyền: trước đây MỖI request (kể cả hỏi ver 4 giây/lần, Vọng gác, lịch sử dòng…) gọi lại Supabase 2–4 lượt
 *  (claims, hồ sơ, quyền, vai trò quản trị) trước khi làm việc thật → trang chạy nặng thì 1 thao tác cũng chờ vài giây.
 *  Giờ nhớ kết quả theo đúng phiên đăng nhập (cookie sb-* của trình duyệt, chỉ giữ mã băm) trong 60 giây:
 *  đổi tài khoản / đăng xuất = cookie khác → tra lại; bị thu hồi quyền → tối đa 60 giây sau có hiệu lực. */
type AuthHit = { exp: number; acc: Promise<Awaited<ReturnType<typeof getAccountContext>>>; admin?: Promise<boolean> };
const AUTH = new Map<string, AuthHit>();
const AUTH_TTL = 60_000;
async function authHit(): Promise<AuthHit> {
  let key = "";
  try { key = (await cookies()).getAll().filter((c) => c.name.startsWith("sb-")).map((c) => c.name + "=" + c.value).sort().join(";"); } catch { key = ""; }
  if (!key) return { exp: 0, acc: getAccountContext() };                                   // không có phiên (worker, gọi nội bộ): không nhớ
  const k = createHash("sha256").update(key).digest("base64url"), t = Date.now();
  const hit = AUTH.get(k);
  if (hit && hit.exp > t) return hit;
  if (AUTH.size > 500) for (const [kk, v] of AUTH) if (v.exp <= t) AUTH.delete(kk);
  const h: AuthHit = { exp: t + AUTH_TTL, acc: getAccountContext() };
  h.acc.then((a) => { if (!a?.workspaceId) AUTH.delete(k); }, () => AUTH.delete(k));       // lỗi / chưa đăng nhập: không nhớ
  AUTH.set(k, h);
  return h;
}
export async function accountCtx() { return (await authHit()).acc; }
export async function requireHs(level: Level = "view") {
  const h = await authHit(), account = await h.acc;
  if (!account?.workspaceId) throw new HsError("Chưa đăng nhập", 401);
  if (!account.permissions.includes("accounts.view")) throw new HsError("Bạn chưa được cấp quyền mục Tài khoản", 403);
  if (level === "manage" && !(await (h.admin ??= isWorkspaceAdmin()))) throw new HsError("Chỉ Quản trị viên được dùng chức năng này", 403);
  await ensureBucket().catch((e) => console.error("[accountshs]", e));   // lỗi bucket chỉ ảnh hưởng đính kèm / sao lưu
  return account;
}
export { hasPermission };

export const toIds = (xs: unknown): Id[] => (Array.isArray(xs) ? xs : []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
export function chunks<X>(xs: X[], n: number): X[][] { const out: X[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; }
