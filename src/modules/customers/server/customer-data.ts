import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { fold } from "../core/partner-parse";

export const CUSTOMER_PAGE_SIZE = 50;
const COLUMNS = "partner_id,block_ids,name,partner_type,status,address,email,phone,website,contact_name,position,sale_human_id,sale_name,am_human_id,am_name,am2_human_id,am2_name,note,email_sent_at";

export interface CustomerFilters { q: string; block: number | null; status: string | null; type: string | null; owner: string | null; has: "email" | "phone" | null; page: number }
export interface CustomerRow {
  partner_id: number; block_ids: number[]; name: string | null; partner_type: string | null; status: string | null; address: string | null; email: string | null; phone: string | null;
  website: string | null; contact_name: string | null; position: string | null; sale_human_id: string | null; sale_name: string | null; am_human_id: string | null; am_name: string | null;
  am2_human_id: string | null; am2_name: string | null; note: string | null; email_sent_at: string | null;
}

export function customerFilters(params: Record<string, string | string[] | undefined>): CustomerFilters {
  const one = (key: string) => { const value = params[key]; return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : ""; };
  const block = Number(one("block")); const page = Number(one("page"));
  return {
    q: one("q").trim().slice(0, 100), block: Number.isSafeInteger(block) && block > 0 ? block : null,
    status: one("status").slice(0, 200) || null, type: one("type").slice(0, 200) || null, owner: /^(me|[0-9a-f-]{36})$/iu.test(one("owner")) ? one("owner") : null,
    has: one("has") === "email" || one("has") === "phone" ? one("has") as "email" | "phone" : null, page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1000) : 1,
  };
}

export async function customerContext() {
  const account = await getAccountContext();
  if (!account?.workspaceId || !account.permissions.includes("customers.view")) return null;
  return { ...account, workspaceId: account.workspaceId, viewAll: account.permissions.includes("customers.view_all"), canManage: account.permissions.includes("customers.manage") };
}

/** One page of customers (row level security decides which ones), with what the filters need. */
export async function listCustomers(filters: CustomerFilters) {
  const context = await customerContext();
  if (!context) return null;
  const db = await createClient();
  const [{ data: blocks }, { data: facets }, { data: links }, { data: lastSync }] = await Promise.all([
    db.from("human_partner_blocks").select("block_id,name,enabled,last_synced_at,last_count,last_error").eq("workspace_id", context.workspaceId).order("sort").order("block_id"),
    db.rpc("human_partner_facets"),
    db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", context.workspaceId),
    db.from("human_partner_syncs").select("started_at,finished_at,ok,rows,error").eq("workspace_id", context.workspaceId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const linkRows = (links ?? []) as Link[];
  const query = filteredQuery(db, context, filters, linkRows, COLUMNS);
  const from = (filters.page - 1) * CUSTOMER_PAGE_SIZE;
  const { data, count, error } = await query.order("partner_id", { ascending: false }).range(from, from + CUSTOMER_PAGE_SIZE - 1);
  const facetRows = (facets ?? []) as Array<{ kind: string; value: string; total: number }>;
  const options = (kind: string) => facetRows.filter((row) => row.kind === kind).sort((a, b) => Number(b.total) - Number(a.total)).map((row) => ({ value: row.value || "—", total: Number(row.total) }));
  return {
    context, error: error ? "Chưa tải được danh sách khách hàng." : null, rows: (data ?? []) as unknown as CustomerRow[], total: count ?? 0,
    pages: Math.max(1, Math.ceil((count ?? 0) / CUSTOMER_PAGE_SIZE)),
    blocks: (blocks ?? []) as Array<{ block_id: number; name: string | null; enabled: boolean; last_synced_at: string | null; last_count: number | null; last_error: string | null }>,
    blockCounts: Object.fromEntries(options("block").map((row) => [row.value, row.total])) as Record<string, number>,
    statuses: options("status"), types: options("type"),
    linkedPeople: await linkedPeople(db, context.workspaceId, linkRows),
    lastSync: lastSync as { started_at: string; finished_at: string | null; ok: boolean | null; rows: number | null; error: string | null } | null,
  };
}

type Db = Awaited<ReturnType<typeof createClient>>;
type Context = NonNullable<Awaited<ReturnType<typeof customerContext>>>;
type Link = { human_user_id: string; human_name: string | null; profile_id: string | null };
function filteredQuery(db: Db, context: Context, filters: CustomerFilters, linkRows: Link[], columns: string) {
  let query = db.from("human_partners").select(columns, { count: "exact" }).eq("workspace_id", context.workspaceId).eq("active", true);
  if (filters.q) query = query.ilike("search_text", `%${fold(filters.q).replace(/[%_\\]/gu, "")}%`);
  if (filters.block) query = query.contains("block_ids", [filters.block]);
  if (filters.status !== null) query = filters.status === "—" ? query.is("status", null) : query.eq("status", filters.status);
  if (filters.type !== null) query = filters.type === "—" ? query.is("partner_type", null) : query.eq("partner_type", filters.type);
  if (filters.has === "email") query = query.not("email", "is", null);
  if (filters.has === "phone") query = query.not("phone", "is", null);
  if (filters.owner) {
    const profileId = filters.owner === "me" ? context.userId : filters.owner;
    const ids = linkRows.filter((link) => link.profile_id === profileId).map((link) => link.human_user_id.replace(/[^A-Za-z0-9_.@-]/gu, ""));
    query = ids.length ? query.or(`sale_human_id.in.(${ids.join(",")}),am_human_id.in.(${ids.join(",")}),am2_human_id.in.(${ids.join(",")})`) : query.eq("partner_id", -1);
  }
  return query;
}

/** Every customer the filters select (at most 10,000), for the CSV export. */
export async function exportCustomers(filters: CustomerFilters) {
  const context = await customerContext();
  if (!context) return null;
  const db = await createClient();
  const { data: links } = await db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", context.workspaceId);
  const rows: CustomerRow[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await filteredQuery(db, context, filters, (links ?? []) as Link[], COLUMNS).order("partner_id", { ascending: false }).range(from, from + 999);
    if (error) return null;
    rows.push(...((data ?? []) as unknown as CustomerRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** One customer with every field Human sent, the HireX members behind its Sale / AM, and matching Suối Nguồn conversations. */
export async function getCustomer(partnerId: number) {
  const context = await customerContext();
  if (!context || !Number.isSafeInteger(partnerId)) return null;
  const db = await createClient();
  const { data: row } = await db.from("human_partners").select(`${COLUMNS},data,synced_at,active`).eq("workspace_id", context.workspaceId).eq("partner_id", partnerId).maybeSingle();
  if (!row) return null;
  const customer = row as CustomerRow & { data: Record<string, unknown>; synced_at: string; active: boolean };
  const humanIds = [customer.sale_human_id, customer.am_human_id, customer.am2_human_id].filter((id): id is string => Boolean(id));
  const emails = [...new Set((customer.email ?? "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gu) ?? [])].slice(0, 5);
  const phones = [...new Set((customer.phone ?? "").split(/[,;/|\n]+/u).map(phoneKey).filter((value): value is string => Boolean(value)))].slice(0, 5);
  const [{ data: links }, contactResult] = await Promise.all([
    humanIds.length ? db.from("human_user_links").select("human_user_id,profile_id").eq("workspace_id", context.workspaceId).in("human_user_id", humanIds) : Promise.resolve({ data: [] }),
    emails.length || phones.length ? db.from("contacts").select("id,full_name,email,phone").eq("workspace_id", context.workspaceId)
      .or([...emails.map((email) => `email.ilike.${email}`), ...phones.flatMap((phone) => [`phone.eq.${phone}`, `phone.eq.0${phone.slice(2)}`, `phone.eq.+${phone}`])].join(",")).limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const contactIds = ((contactResult.data ?? []) as Array<{ id: string }>).map((contact) => contact.id);
  const { data: conversations } = contactIds.length
    ? await db.from("omnichannel_conversations").select("id,channel_type,channel_account_id,subject,last_message_at,metadata").eq("workspace_id", context.workspaceId)
      .in("contact_id", contactIds).order("last_message_at", { ascending: false, nullsFirst: false }).limit(10)
    : { data: [] };
  const linkRows = (links ?? []) as Array<{ human_user_id: string; profile_id: string | null }>;
  const conversationRows = (conversations ?? []) as Array<{ id: string; channel_type: string; channel_account_id: string; subject: string | null; last_message_at: string | null; metadata: Record<string, unknown> | null }>;
  const profileIds = [...new Set(linkRows.flatMap((link) => link.profile_id ? [link.profile_id] : []))];
  const accountIds = [...new Set(conversationRows.map((item) => item.channel_account_id))];
  const [{ data: profiles }, { data: accounts }] = await Promise.all([
    profileIds.length ? db.from("profiles").select("id,full_name").eq("workspace_id", context.workspaceId).in("id", profileIds) : Promise.resolve({ data: [] }),
    accountIds.length ? db.from("channel_accounts").select("id,display_name").eq("workspace_id", context.workspaceId).in("id", accountIds) : Promise.resolve({ data: [] }),
  ]);
  const profileName = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [row.id, row.full_name]));
  const accountName = new Map(((accounts ?? []) as Array<{ id: string; display_name: string | null }>).map((row) => [row.id, row.display_name]));
  const members = new Map(linkRows.map((link) => [link.human_user_id, link.profile_id ? profileName.get(link.profile_id) ?? null : null] as const));
  return {
    context, customer, member: (id: string | null) => id ? members.get(id) ?? null : null,
    conversations: conversationRows.map((item) => {
      const name = item.metadata?.participantDisplayName ?? item.metadata?.groupName ?? item.subject;
      return { id: item.id, channel: item.channel_type, name: typeof name === "string" ? name : "Hội thoại", account: accountName.get(item.channel_account_id) ?? "", at: item.last_message_at };
    }),
  };
}

/** Vietnamese phone as "84xxxxxxxxx" (for matching), or null. */
function phoneKey(value: string) {
  const digits = value.replace(/\D/gu, "");
  if (/^0\d{9}$/u.test(digits)) return `84${digits.slice(1)}`;
  if (/^84\d{9}$/u.test(digits)) return digits;
  return null;
}

async function linkedPeople(db: Db, workspaceId: string, links: Link[]) {
  const ids = [...new Set(links.flatMap((link) => link.profile_id ? [link.profile_id] : []))];
  if (!ids.length) return [];
  const { data } = await db.from("profiles").select("id,full_name").eq("workspace_id", workspaceId).in("id", ids);
  return ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => ({ id: row.id, name: row.full_name ?? "?" })).sort((a, b) => a.name.localeCompare(b.name, "vi"));
}
