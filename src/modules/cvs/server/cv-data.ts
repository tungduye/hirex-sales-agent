import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { fold } from "@/modules/customers/core/partner-parse";
import { cvDetail } from "./cv-details";

// Màn CV (read with the member's session: row level security decides which CVs, by Rec or "Xem tất cả CV").

export const CV_PAGE_SIZE = 50;
const COLUMNS = "cv_id,history_id,history_count,block_keys,code,name,phone,email,position,skill,skill_tech,location,languages,status1,status2,recer_human_id,recer_name,partner_name,companies,salary,human_created_at,human_updated_at,phone_keys,email_keys,applications";

export interface CvFilters { q: string; block: string | null; status1: string | null; status2: string | null; position: string | null; loc: string | null; owner: string | null; page: number }
export interface CvRow {
  cv_id: number; history_id: number | null; history_count: number; block_keys: string[]; code: string | null; name: string | null; phone: string | null; email: string | null;
  position: string | null; skill: string | null; skill_tech: string | null; location: string | null; languages: string | null; status1: string | null; status2: string | null;
  recer_human_id: string | null; recer_name: string | null; partner_name: string | null; companies: string | null; salary: string | null;
  human_created_at: string | null; human_updated_at: string | null; phone_keys: string[]; email_keys: string[];
  applications: Array<{ history_id: number | null; partner_id: number | null; partner_name: string | null; status1: string | null; status2: string | null; updated_at: string | null; status2_at: string | null }>;
}

export function cvFilters(params: Record<string, string | string[] | undefined>): CvFilters {
  const one = (key: string) => { const value = params[key]; return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : ""; };
  const page = Number(one("page"));
  return {
    q: one("q").trim().slice(0, 100), block: /^[A-Za-z0-9_-]{1,60}$/u.test(one("block")) ? one("block") : null,
    status1: one("s1").slice(0, 200) || null, status2: one("s2").slice(0, 300) || null, position: one("pos").slice(0, 300) || null, loc: one("loc").slice(0, 300) || null,
    owner: /^(me|[0-9a-f-]{36})$/iu.test(one("owner")) ? one("owner") : null, page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 2000) : 1,
  };
}

export async function cvContext() {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.permissions.includes("cvs.view")) return null;
  return { ...account, workspaceId: account.workspaceId, viewAll: account.permissions.includes("cvs.view_all"), canManage: account.permissions.includes("cvs.manage") };
}

type Db = Awaited<ReturnType<typeof createClient>>;
type Context = NonNullable<Awaited<ReturnType<typeof cvContext>>>;
type Link = { human_user_id: string; human_name: string | null; profile_id: string | null };

function filteredQuery(db: Db, context: Context, filters: CvFilters, links: Link[], columns: string) {
  let query = db.from("human_cvs").select(columns, { count: "exact" }).eq("workspace_id", context.workspaceId).eq("active", true);
  if (filters.q) {
    const digits = filters.q.replace(/\D/gu, "");
    const phone = /^0\d{9}$/u.test(digits) ? `84${digits.slice(1)}` : /^84\d{9}$/u.test(digits) ? digits : null;
    const pattern = `%${fold(filters.q).replace(/[%_\\,()]/gu, "")}%`;
    query = phone ? query.contains("phone_keys", [phone]) : query.or(`search_text.ilike.${pattern},detail_search.ilike.${pattern}`);
  }
  if (filters.block) query = query.contains("block_keys", [filters.block]);
  for (const [column, value] of [["status1", filters.status1], ["status2", filters.status2], ["position", filters.position], ["location", filters.loc]] as const)
    if (value !== null) query = value === "—" ? query.is(column, null) : query.eq(column, value);
  if (filters.owner) {
    const profileId = filters.owner === "me" ? context.userId : filters.owner;
    const ids = links.filter((link) => link.profile_id === profileId).map((link) => link.human_user_id);
    query = ids.length ? query.in("recer_human_id", ids) : query.eq("cv_id", -1);
  }
  return query;
}

/** Human user id (Rec) → the linked HireX member's name, or the name Human gave. */
async function personNames(db: Db, workspaceId: string, links: Link[]) {
  const ids = [...new Set(links.flatMap((link) => link.profile_id ? [link.profile_id] : []))];
  const { data } = ids.length ? await db.from("profiles").select("id,full_name").eq("workspace_id", workspaceId).in("id", ids) : { data: [] };
  const members = ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => ({ id: row.id, name: row.full_name ?? "?" })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const names = new Map(members.map((member) => [member.id, member.name]));
  return { members, byHuman: Object.fromEntries(links.flatMap((link) => { const name = (link.profile_id && names.get(link.profile_id)) || link.human_name; return name ? [[link.human_user_id, name]] : []; })) as Record<string, string> };
}

export async function listCvs(filters: CvFilters) {
  const context = await cvContext();
  if (!context) return null;
  const db = await createClient();
  const [{ data: blocks }, { data: facets }, { data: links }, { data: lastSync }] = await Promise.all([
    db.from("human_cv_blocks").select("block_key,name,enabled,last_synced_at,last_count,last_error").eq("workspace_id", context.workspaceId).order("sort").order("block_key"),
    db.rpc("human_cv_facets"),
    db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", context.workspaceId),
    db.from("human_cv_syncs").select("started_at,finished_at,ok,rows,error").eq("workspace_id", context.workspaceId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const linkRows = (links ?? []) as Link[];
  const from = (filters.page - 1) * CV_PAGE_SIZE;
  const { data, count, error } = await filteredQuery(db, context, filters, linkRows, COLUMNS).order("cv_id", { ascending: false }).range(from, from + CV_PAGE_SIZE - 1);
  const facetRows = (facets ?? []) as Array<{ kind: string; value: string; total: number }>;
  const options = (kind: string) => facetRows.filter((row) => row.kind === kind).sort((a, b) => Number(b.total) - Number(a.total)).map((row) => ({ value: row.value || "—", total: Number(row.total) }));
  const people = await personNames(db, context.workspaceId, linkRows);
  return {
    context, error: error ? "Chưa tải được danh sách CV." : null, rows: (data ?? []) as unknown as CvRow[], total: count ?? 0,
    pages: Math.max(1, Math.ceil((count ?? 0) / CV_PAGE_SIZE)),
    blocks: (blocks ?? []) as Array<{ block_key: string; name: string | null; enabled: boolean; last_synced_at: string | null; last_count: number | null; last_error: string | null }>,
    blockCounts: Object.fromEntries(options("block").map((row) => [row.value, row.total])) as Record<string, number>,
    statuses1: options("status1"), statuses2: options("status2"), positions: options("position"), locations: options("location"),
    personName: people.byHuman, linkedPeople: people.members,
    lastSync: lastSync as { started_at: string; finished_at: string | null; ok: boolean | null; rows: number | null; error: string | null } | null,
  };
}

/** One CV with every field Human sent, its Rec, the same person's other CVs, and matching Suối Nguồn conversations. */
export async function getCv(cvId: number) {
  const context = await cvContext();
  if (!context || !Number.isSafeInteger(cvId)) return null;
  const db = await createClient();
  const { data: row } = await db.from("human_cvs").select(`${COLUMNS},data,synced_at,active`).eq("workspace_id", context.workspaceId).eq("cv_id", cvId).maybeSingle();
  if (!row) return null;
  const cv = row as unknown as CvRow & { data: Record<string, unknown>; synced_at: string; active: boolean };
  // Hồ sơ chi tiết: the kept copy, or fetched now when missing / changed / old (the member may see this CV: read above with their rights).
  const detailPromise = cvDetail(context.workspaceId, cvId).catch(() => null);
  const [conversations, { data: sameRows }, { data: links }] = await Promise.all([
    conversationsFor(db, context.workspaceId, cv.phone_keys ?? [], cv.email_keys ?? []),
    cv.phone_keys?.length || cv.email_keys?.length
      ? db.from("human_cvs").select("cv_id,name,position,status2,human_updated_at").eq("workspace_id", context.workspaceId).neq("cv_id", cvId)
        .or([cv.phone_keys?.length ? `phone_keys.ov.{${cv.phone_keys.join(",")}}` : "", cv.email_keys?.length ? `email_keys.ov.{${cv.email_keys.map((email) => `"${email}"`).join(",")}}` : ""].filter(Boolean).join(",")).limit(10)
      : Promise.resolve({ data: [] }),
    db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", context.workspaceId),
  ]);
  const people = await personNames(db, context.workspaceId, (links ?? []) as Link[]);
  const detail = await detailPromise;
  const codeIds = [...new Set([...Object.entries(cv.data ?? {}), ...Object.entries(detail?.detail ?? {})].flatMap(([key, value]) => /(id$|rate|rank|address|position|skill|status)/iu.test(key) && value != null && typeof value !== "object" ? String(value).split(/[,;]+/u) : []).map((part) => part.trim()).filter((part) => /^\d{1,12}$/u.test(part)))].slice(0, 80);
  const { data: codeRows } = codeIds.length ? await db.from("human_master_codes").select("master_id,name,kind").eq("workspace_id", context.workspaceId).in("master_id", codeIds) : { data: [] };
  return {
    context, cv, conversations, detail, recer: cv.recer_human_id ? people.byHuman[cv.recer_human_id] ?? cv.recer_name ?? `#${cv.recer_human_id}` : cv.recer_name,
    sameCandidate: (sameRows ?? []) as Array<{ cv_id: number; name: string | null; position: string | null; status2: string | null; human_updated_at: string | null }>,
    codes: Object.fromEntries(((codeRows ?? []) as Array<{ master_id: number; name: string; kind: string | null }>).map((code) => [String(code.master_id), code.kind ? `${code.name} (${code.kind})` : code.name])) as Record<string, string>,
  };
}

/** Suối Nguồn conversations of the contacts with these phones / e-mails, on nicks the member may see. */
export async function conversationsFor(db: Db, workspaceId: string, phones: string[], emails: string[]) {
  if (!phones.length && !emails.length) return [];
  const variants = phones.flatMap((phone) => [phone, `0${phone.slice(2)}`, `+${phone}`]);
  const [{ data: byContact }, { data: byChannel }] = await Promise.all([
    db.from("contacts").select("id").eq("workspace_id", workspaceId).or([...emails.map((email) => `email.ilike.${email}`), ...variants.map((phone) => `phone.eq.${phone}`)].join(",")).limit(20),
    db.from("contact_channels").select("contact_id").eq("workspace_id", workspaceId).in("channel_type", ["PHONE", "EMAIL"]).in("channel_value", [...variants, ...emails]).limit(20),
  ]);
  const contactIds = [...new Set([...(byContact ?? []).map((row) => String(row.id)), ...(byChannel ?? []).map((row) => String(row.contact_id))])];
  if (!contactIds.length) return [];
  const [{ data }, accessible] = await Promise.all([
    db.from("omnichannel_conversations").select("id,channel_type,channel_account_id,subject,last_message_at,metadata").eq("workspace_id", workspaceId).in("contact_id", contactIds)
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(15),
    getAccessibleChannelAccountIds(),
  ]);
  const rows = ((data ?? []) as Array<{ id: string; channel_type: string; channel_account_id: string; subject: string | null; last_message_at: string | null; metadata: Record<string, unknown> | null }>)
    .filter((item) => accessible === null || accessible.includes(item.channel_account_id));
  const accountIds = [...new Set(rows.map((item) => item.channel_account_id))];
  // Nick names are read by the server (members cannot read channel_accounts directly).
  const { data: accounts } = accountIds.length ? await createPrivilegedClient().from("channel_accounts").select("id,display_name").eq("workspace_id", workspaceId).in("id", accountIds) : { data: [] };
  const accountName = new Map(((accounts ?? []) as Array<{ id: string; display_name: string | null }>).map((item) => [item.id, item.display_name]));
  return rows.map((item) => {
    const name = item.metadata?.participantDisplayName ?? item.subject;
    return { id: item.id, channel: item.channel_type, name: typeof name === "string" ? name : "Hội thoại", account: accountName.get(item.channel_account_id) ?? "", at: item.last_message_at };
  });
}
