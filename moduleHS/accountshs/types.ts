// AccountsHS — kiểu dữ liệu dùng chung (giữ đúng tên cột của bảng ahs_* và cấu trúc JSON mà v7.py trả về,
// nên mọi hành vi của bản Python chuyển sang không phải đổi tên).

export type Id = number;
/** epoch giây (double) — giống cột created/updated/ts của Python (time.time()). */
export type Epoch = number;

export interface Dept { id: Id; name: string; color: string; pos: number }
export interface Owner { id: Id; dept_id: Id; parent_id: Id | null; name: string; color: string; pos: number }
export type FieldType = "text" | "secret" | "number" | "date" | "select" | "link" | "url" | "lookup" | "file";
export interface Field { id: Id; tab_id: Id; label: string; type: FieldType; opts: string; link_tab: Id | null; pos: number }
export interface Status { id: Id; tab_id: Id; label: string; color: string; pos: number }
export interface Tab {
  id: Id; name: string; icon: string; color: string; pos: number; grp: string; lazy: number; tint: number;
  fields: Field[]; statuses: Status[];
  /** số dòng của tab "tải riêng" chưa nạp (chỉ có khi lazy=1 và client chưa nạp). */
  lazy_n?: number;
}
export type DeviceKind = "phone" | "pc" | "boxphone";
export interface Device {
  id: Id; dept_id: Id | null; owner_id: Id | null; name: string; kind: DeviceKind; serial: string;
  /** {tab_id: giới hạn số tài khoản} */
  caps: Record<string, number>; note: string; pos: number; created: Epoch | null;
}
/** Giá trị trường kiểu "file": mảng đính kèm. */
export interface Attachment { id: string; n: string; s: number; m: string; t: Epoch }
export type FieldValue = string | number | Attachment[] | null;
export interface Account {
  id: Id; tab_id: Id; dept_id: Id; owner_id: Id | null; status_id: Id | null; device_id: Id | null;
  note: string; data: Record<string, FieldValue>; created: Epoch; updated: Epoch;
}
export interface Link { id: Id; src: Id; dst: Id; f: Id }

export interface Meta { depts: Dept[]; owners: Owner[]; tabs: Tab[]; grp_icons: Record<string, string>; tab_keys: Record<string, Id[]> }
/** /api/data */
export interface Snapshot { meta: Meta; devices: Device[]; accounts: Account[]; links: Link[]; ts: Epoch }
/** /api/delta */
export interface Delta extends Snapshot { deleted: Id[]; delta: 1 }
/** /api/tab_rows */
export interface TabRows { accounts: Account[]; links: Link[] }

export interface LogRow { id: Id; ts: Epoch; act: string; n: number; detail: string; user_name?: string | null }
export interface HistChange { c?: string; f?: Id | string; a: unknown; b: unknown }
export type HistItem =
  | { ts: Epoch; k: "u"; ch: HistChange[] }
  | { ts: Epoch; k: "l+" | "l-"; f?: Id; t?: Id }
  | { ts: Epoch; k: "new" };
export interface HistInfo { days: number; keepdel: boolean; n: number; oldest: Epoch | null }
export interface HistLast { ts: Epoch; k: "u" | "l+" | "l-"; ch?: HistChange[]; n?: number; f?: Id; t?: Id }

export interface BackupCfg { dir: string; enabled: number; every_h: number; keep: number; formats: string[] }
export interface BackupFile { name: string; size: number; mtime: Epoch; kind: "auto" | "manual" | "safe" | "import" | "other"; ext: "ahs" | "xlsx" | "json" }
export interface BackupsInfo { cfg: BackupCfg; dir: string; last: Epoch; files: BackupFile[]; db_size: number }
export interface DbCheck { integrity: string; orphan_links: number; cross_links: number; bad_tab: number; bad_status: number; bad_owner: number; bad_device: number }

/** Báo cáo nhập hàng loạt (bulk2). */
export interface BulkReport {
  created: number; updated: number; skipped: number; same: number; invalid: number; dup_in: number;
  filled: number; changed: number; kept: number; l_created: number; l_updated: number; l_links: number; l_missing: number;
  conflicts: Array<{ ln: number | null; tab: string; key: string; f: string; kind: "changed" | "kept"; secret: boolean }>;
  bad: Array<{ ln: number | null; why: string }>; dry: boolean;
}
export interface BulkLinkItem { k: string; a?: Record<string, string> }
export interface BulkRow { ln?: number; data?: Record<string, string>; status?: string; owner?: string; note?: string; device?: string; links?: Record<string, Array<string | BulkLinkItem>> }
export interface BulkBody {
  tab_id: Id; dept_id: Id; owner_id?: Id | null; status_id?: Id | null; mode?: "skip" | "fill" | "update" | "add"; create?: boolean;
  dry?: boolean; key_field?: Id | string; key_fields?: Array<Id | string>; no_new?: boolean; sid?: string; last?: boolean; rows: BulkRow[];
}

/** Điều kiện lọc cột (S.fl[tab]) */
export type CondKey = Id | "status" | "dept" | "owner" | "device" | "tab" | "label" | "note" | "updated" | "created" | "links" | "outl";
export type Cond =
  | { k: CondKey; op: "empty" | "nempty" }
  | { k: CondKey; op: "has"; v: string }
  | { k: CondKey; op: "list" | "in" | "nin"; v: string[] }
  | { k: CondKey; op: "range"; v: [string, string] };
export interface SortSpec { k: CondKey; d: 1 | -1; ord?: string[] }

/** Tên các route ghi của Python (ROUTES) — server action nhận đúng tên này để client giữ mut(path, body). */
export type RouteName =
  | "ov_trend" | "account" | "status_set" | "owner_set" | "mass_set" | "delete_accounts" | "quick" | "bulk" | "bulk_check" | "delete" | "reorder"
  | "dept" | "owner" | "tab" | "field" | "status" | "device" | "device_set" | "rows_set" | "device_bulk"
  | "backup_now" | "backup_delete" | "backup_rename" | "log_clear" | "hist_cfg" | "grp_icon" | "tab_keys" | "backup_restore" | "backup_cfg" | "repair"
  | "ai_ask" | "ai_cfg" | "ai_learn" | "ai_forget" | "ai_reindex";

export const ACCOUNT_COLS = ["id", "tab_id", "dept_id", "owner_id", "status_id", "device_id", "note", "data", "created", "updated"] as const;
export const META_TABLES = ["depts", "owners", "tabs", "fields", "statuses", "devices"] as const;
export type MetaTable = (typeof META_TABLES)[number];
