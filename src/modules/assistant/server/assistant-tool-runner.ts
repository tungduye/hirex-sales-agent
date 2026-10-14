import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { briefForModel } from "@/modules/assistant/core/daily-brief";
import { CONVERSATION_NAME_KEYS, isGroupConversation, metadataName, type AssistantToolDefinition } from "@/modules/assistant/core/assistant-tools";
import { createProposal, type ActionContext, type PendingAction } from "@/modules/assistant/server/assistant-proposals";
import { getCampaignWorkerHealth } from "@/modules/campaigns/server/campaign-worker-health";
import { listCampaigns } from "@/modules/campaigns/server/campaign-data";
import { listChannelAccounts } from "@/modules/channels/server/list-channel-accounts";
import { listChannelCampaigns, listFacebookProfileCampaigns } from "@/modules/channels/server/get-channel-campaign-data";
import { getChannelDeliveryReport } from "@/modules/channels/server/get-channel-delivery-report";
import { contentSearchPattern } from "@/modules/content/core/content-list-query";
import { contactSearchPattern } from "@/modules/crm/contacts/core/contact-list-query";
import { getDashboardData } from "@/modules/crm/dashboard/server/get-dashboard-data";
import { listEmailAccounts } from "@/modules/integrations/gmail/server/list-email-accounts";

// Every tool here only reads. Data is fetched with the member's own Supabase session (RLS) or
// through the same server helpers the pages use, which apply the member's channel-account scope.
// Free text written by outsiders (messages, names) is returned under keys marked "khach_viet" so
// the model treats it as data.

export interface ToolScope { workspaceId: string; userId: string; context: ActionContext; proposals: PendingAction[] }

const HOUR = 3_600_000;
const clip = (value: unknown, max = 300) => typeof value === "string" ? (value.length > max ? `${value.slice(0, max)}…` : value) : null;
const time = (value: unknown) => typeof value === "string" ? value : null;

/** "nguyenvana@gmail.com" → "ng***@gmail.com": enough to tell same-name contacts apart. */
function maskEmail(email: unknown) {
  if (typeof email !== "string" || !email.includes("@")) return null;
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}***@${domain}`;
}
function maskPhone(phone: unknown) {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `SĐT …${digits.slice(-3)}` : null;
}

export interface WaitingRow { id: string; channel: string; account: string | null; name: string | null; group: boolean; since: string; hours: number; unread: number; assigned: boolean; lastText: string | null; link: string }

/**
 * Conversations (last 7 days, scoped to the member's channel accounts) whose latest message is from
 * the customer and is at least minHours old, longest wait first. Used by the assistant and the brief.
 */
export async function listWaitingConversations(workspaceId: string, minHours: number): Promise<{ rows: WaitingRow[] } | { loi: string }> {
  const supabase = await createClient();
  const accessible = await getAccessibleChannelAccountIds();
  if (accessible?.length === 0) return { rows: [] };
  let query = supabase.from("omnichannel_conversations")
    .select("id,channel_account_id,channel_type,contact_id,last_message_at,unread_count,assigned_to,metadata")
    .eq("workspace_id", workspaceId)
    .gte("last_message_at", new Date(Date.now() - 7 * 24 * HOUR).toISOString())
    .or("metadata->>hidden.is.null,metadata->>hidden.neq.true")
    .order("last_message_at", { ascending: false }).limit(300);
  if (accessible) query = query.in("channel_account_id", accessible);
  const { data: conversations, error } = await query;
  if (error) return { loi: "Không tải được Hồ Chứa." };
  const rows = conversations ?? [];
  const latest = new Map<string, { direction: string; text: string | null; at: string }>();
  for (let offset = 0; offset < rows.length; offset += 25) {
    const ids = rows.slice(offset, offset + 25).map((row) => row.id);
    const { data: messages } = await supabase.from("omnichannel_messages").select("conversation_id,direction,text_content,received_at,sent_at,created_at")
      .eq("workspace_id", workspaceId).in("conversation_id", ids).order("created_at", { ascending: false }).limit(1000);
    for (const message of messages ?? []) {
      if (latest.has(message.conversation_id)) continue;
      latest.set(message.conversation_id, { direction: message.direction, text: message.text_content, at: message.received_at ?? message.sent_at ?? message.created_at });
    }
  }
  const cutoff = Date.now() - minHours * HOUR;
  const waiting = rows.filter((row) => { const last = latest.get(row.id); return last?.direction === "INBOUND" && Date.parse(last.at) <= cutoff; });
  const contactIds = [...new Set(waiting.flatMap((row) => row.contact_id ? [row.contact_id] : []))];
  const accountIds = [...new Set(waiting.map((row) => row.channel_account_id))];
  const [contacts, accounts] = await Promise.all([
    contactIds.length ? supabase.from("contacts").select("id,full_name").in("id", contactIds.slice(0, 300)) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    accountIds.length ? createPrivilegedClient().from("channel_accounts").select("id,display_name").eq("workspace_id", workspaceId).in("id", accountIds) : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ]);
  const contactName = new Map((contacts.data ?? []).map((row) => [row.id, row.full_name]));
  const accountName = new Map((accounts.data ?? []).map((row) => [row.id, row.display_name]));
  return {
    rows: waiting.map((row) => {
      const last = latest.get(row.id)!;
      return {
        id: row.id, channel: row.channel_type, account: accountName.get(row.channel_account_id) ?? null,
        name: contactName.get(row.contact_id ?? "") ?? metadataName(row.metadata), group: isGroupConversation(row.metadata),
        since: last.at, hours: (Date.now() - Date.parse(last.at)) / HOUR, unread: row.unread_count, assigned: Boolean(row.assigned_to),
        lastText: last.text, link: `/inbox/all/${row.id}`,
      };
    }).sort((a, b) => b.hours - a.hours),
  };
}

type Runner = (args: Record<string, unknown>, scope: ToolScope) => Promise<unknown>;

const runners: Record<string, Runner> = {
  async tong_quan_crm() {
    const data = await getDashboardData();
    if (data.metricsHaveError) return { loi: "Không tải được số liệu tổng quan." };
    return {
      ...data.metrics,
      lien_he_moi_nhat: data.recentContacts.map((contact) => ({ ten: contact.fullName, cong_ty: contact.companyName, trang_thai: contact.leadStatus, tao_luc: contact.createdAt, link: `/contacts/${contact.id}` })),
    };
  },

  async tinh_trang_kenh() {
    const [channels, gmail] = await Promise.all([listChannelAccounts(), listEmailAccounts()]);
    // An account can show CONNECTED while its last call failed (e.g. a Facebook token without permission).
    const problem = channels.accounts.filter((item) => item.status !== "CONNECTED" || !item.operatorEnabled || item.providerHealthStatus !== "HEALTHY" || Boolean(item.lastErrorCode));
    const gmailProblem = gmail.accounts.filter((item) => item.status !== "CONNECTED" || !item.sendEnabled);
    return {
      tai_khoan_kenh: { tong: channels.accounts.length, dang_tot: channels.accounts.length - problem.length, loi: channels.error },
      kenh_can_xu_ly: problem.slice(0, 40).map((item) => ({
        kenh: item.channelType, ten: item.displayName, trang_thai: item.status, bat_boi_nguoi_van_hanh: item.operatorEnabled,
        suc_khoe: item.providerHealthStatus, ly_do: item.providerHealthReasonCode ?? item.lastErrorCode, kiem_tra_luc: item.providerHealthCheckedAt ?? item.lastHealthCheckAt,
      })),
      gmail: { tong: gmail.accounts.length, dang_tot: gmail.accounts.length - gmailProblem.length, loi: gmail.error },
      gmail_can_xu_ly: gmailProblem.slice(0, 40).map((item) => ({ email: item.emailAddress, trang_thai: item.status, duoc_phep_gui: item.sendEnabled, dong_bo_cuoi: item.lastSyncAt })),
      link: "/settings/channels",
    };
  },

  async tinh_trang_bo_gui_email() {
    const health = await getCampaignWorkerHealth();
    const runs = health.runs as Array<Record<string, unknown>>;
    const lastSuccess = runs.find((run) => run.status === "SUCCEEDED" || run.status === "DRY_RUN");
    return {
      trang_thai: health.state,
      giai_thich: { HEALTHY: "chạy đều (thành công trong 3 phút)", WARNING: "chậm (3–10 phút chưa chạy xong)", STALE: "có thể đã dừng (hơn 10 phút)", UNKNOWN: "không đọc được" }[health.state],
      lan_thanh_cong_cuoi: time(lastSuccess?.finished_at),
      lan_chay_gan_day: runs.slice(0, 8).map((run) => ({ bat_dau: time(run.started_at), trang_thai: run.status, da_gui: run.sent, loi: run.failed, ma_loi: run.safe_error_code })),
      link: "/campaigns",
    };
  },

  async trang_thai_ai_recruiter(_args, scope) {
    const db = createPrivilegedClient();
    const since = new Date(Date.now() - 24 * HOUR).toISOString();
    const [bots, runs] = await Promise.all([
      db.from("ai_recruiter_bots").select("id,name,bot_type,enabled,mode").eq("workspace_id", scope.workspaceId).order("bot_type"),
      db.from("ai_recruiter_runs").select("bot_id,status,safe_error_code").eq("workspace_id", scope.workspaceId).gte("created_at", since).limit(5000),
    ]);
    if (bots.error || runs.error) return { loi: "Không tải được dữ liệu AI Recruiter." };
    const byBot = new Map<string, Record<string, number>>();
    const errors = new Map<string, number>();
    for (const run of runs.data ?? []) {
      const counts = byBot.get(run.bot_id) ?? {};
      counts[run.status] = (counts[run.status] ?? 0) + 1;
      byBot.set(run.bot_id, counts);
      if (run.safe_error_code) errors.set(run.safe_error_code, (errors.get(run.safe_error_code) ?? 0) + 1);
    }
    return {
      bots: (bots.data ?? []).map((bot) => ({ id: bot.id, ten: bot.name, loai: bot.bot_type, dang_bat: bot.enabled, che_do: bot.mode, luot_24h_theo_trang_thai: byBot.get(bot.id) ?? {} })),
      ma_loi_24h: Object.fromEntries([...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)),
      link: "/settings/ai-recruiter",
    };
  },

  async hoi_thoai_cho_tra_loi(args, scope) {
    const minHours = typeof args.gio_toi_thieu === "number" ? args.gio_toi_thieu : 2;
    const limit = typeof args.so_luong === "number" ? args.so_luong : 15;
    const result = await listWaitingConversations(scope.workspaceId, minHours);
    if ("loi" in result) return result;
    return {
      tong_cho_tra_loi: result.rows.length,
      dieu_kien: `tin cuối của khách, chờ từ ${minHours} giờ trở lên, hội thoại có tin trong 7 ngày`,
      hoi_thoai: result.rows.slice(0, limit).map((row) => ({
        kenh: row.channel, tai_khoan: row.account, ten_khach: row.name, nhom_chat: row.group || undefined,
        cho_tu: row.since, so_gio_cho: Math.round(row.hours * 10) / 10, chua_doc: row.unread, da_giao_cho_ai: row.assigned,
        tin_cuoi_khach_viet: clip(row.lastText, 200), link: row.link,
      })),
    };
  },

  async ban_tin_hom_nay() {
    const { getDailyBrief } = await import("@/modules/assistant/server/daily-brief");
    const result = await getDailyBrief({ refresh: false });
    if (!result.ok) return { loi: result.message };
    return { ...briefForModel(result.brief), link: "/" };
  },

  async tim_hoi_thoai(args, scope) {
    const pattern = contactSearchPattern(String(args.tu_khoa));
    if (!pattern) return { hoi_thoai: [] };
    const supabase = await createClient();
    const accessible = await getAccessibleChannelAccountIds();
    if (accessible?.length === 0) return { hoi_thoai: [], ghi_chu: "Tài khoản chưa được cấp kênh nào." };
    const { data: contacts } = await supabase.from("contacts").select("id,full_name").eq("workspace_id", scope.workspaceId).ilike("full_name", pattern.replace(/\*/g, "%")).limit(40);
    const contactName = new Map((contacts ?? []).map((row) => [row.id, row.full_name]));
    const filters = CONVERSATION_NAME_KEYS.map((key) => `metadata->>${key}.ilike.${pattern}`);
    if (contactName.size) filters.push(`contact_id.in.(${[...contactName.keys()].join(",")})`);
    let query = supabase.from("omnichannel_conversations").select("id,channel_account_id,channel_type,contact_id,last_message_at,metadata")
      .eq("workspace_id", scope.workspaceId).or(filters.join(",")).order("last_message_at", { ascending: false, nullsFirst: false }).limit(8);
    if (accessible) query = query.in("channel_account_id", accessible);
    const { data: rows, error } = await query;
    if (error) return { loi: "Không tìm được hội thoại." };
    const conversations = rows ?? [];
    if (!conversations.length) return { hoi_thoai: [], ghi_chu: "Không có hội thoại nào khớp tên này trong các tài khoản được phép xem." };
    const ids = conversations.map((row) => row.id);
    const missingContacts = [...new Set(conversations.flatMap((row) => row.contact_id && !contactName.has(row.contact_id) ? [row.contact_id] : []))];
    const [messages, accounts, extraContacts] = await Promise.all([
      supabase.from("omnichannel_messages").select("conversation_id,direction,text_content,received_at,sent_at,created_at").eq("workspace_id", scope.workspaceId).in("conversation_id", ids).order("created_at", { ascending: false }).limit(200),
      createPrivilegedClient().from("channel_accounts").select("id,display_name").eq("workspace_id", scope.workspaceId).in("id", [...new Set(conversations.map((row) => row.channel_account_id))]),
      missingContacts.length ? supabase.from("contacts").select("id,full_name").in("id", missingContacts) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ]);
    for (const row of extraContacts.data ?? []) contactName.set(row.id, row.full_name);
    const latest = new Map<string, { direction: string; text: string | null; at: string }>();
    for (const message of messages.data ?? []) if (!latest.has(message.conversation_id)) latest.set(message.conversation_id, { direction: message.direction, text: message.text_content, at: message.received_at ?? message.sent_at ?? message.created_at });
    const accountName = new Map((accounts.data ?? []).map((row) => [row.id, row.display_name]));
    return {
      hoi_thoai: conversations.map((row) => {
        const last = latest.get(row.id);
        return {
          id: row.id, kenh: row.channel_type, tai_khoan: accountName.get(row.channel_account_id) ?? null,
          ten_khach: contactName.get(row.contact_id ?? "") ?? metadataName(row.metadata),
          nhom_chat: isGroupConversation(row.metadata),
          tin_cuoi: last ? { cua: last.direction === "INBOUND" ? "KHACH" : "BEN_MINH", luc: last.at, noi_dung_khach_viet: clip(last.text, 160) } : null,
          link: `/inbox/all/${row.id}`,
        };
      }),
    };
  },

  async chi_tiet_hoi_thoai(args, scope) {
    const id = String(args.conversation_id);
    const supabase = await createClient();
    const accessible = await getAccessibleChannelAccountIds();
    const { data: conversation } = await supabase.from("omnichannel_conversations")
      .select("id,channel_account_id,channel_type,contact_id,status,takeover_mode,assigned_to,last_message_at,unread_count,metadata")
      .eq("workspace_id", scope.workspaceId).eq("id", id).maybeSingle();
    if (!conversation || (accessible && !accessible.includes(conversation.channel_account_id))) return { loi: "Không tìm thấy hội thoại hoặc tài khoản không có quyền xem." };
    const [{ data: messages }, contact] = await Promise.all([
      supabase.from("omnichannel_messages").select("direction,text_content,attachment_count,received_at,sent_at,created_at")
        .eq("workspace_id", scope.workspaceId).eq("conversation_id", id).order("created_at", { ascending: false }).limit(20),
      conversation.contact_id ? supabase.from("contacts").select("id,full_name,job_title,lead_status").eq("id", conversation.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
    return {
      id: conversation.id, kenh: conversation.channel_type, trang_thai: conversation.status, che_do_tiep_quan: conversation.takeover_mode,
      ai_recruiter_che_do_rieng: typeof metadata.aiRecruiterModeOverride === "string" ? metadata.aiRecruiterModeOverride : null,
      lien_he: contact.data ? { id: contact.data.id, ten: contact.data.full_name, chuc_danh: contact.data.job_title, trang_thai_lead: contact.data.lead_status, link: `/contacts/${contact.data.id}` } : null,
      tin_nhan_moi_nhat_truoc: (messages ?? []).map((message) => ({
        chieu: message.direction === "INBOUND" ? "KHACH_GUI" : "BEN_MINH_GUI",
        luc: message.received_at ?? message.sent_at ?? message.created_at,
        noi_dung_khach_viet: message.direction === "INBOUND" ? clip(message.text_content, 500) : undefined,
        noi_dung_ben_minh: message.direction === "OUTBOUND" ? clip(message.text_content, 500) : undefined,
        tep_dinh_kem: message.attachment_count || undefined,
      })),
      link: `/inbox/all/${id}`,
    };
  },

  async chien_dich(args) {
    const kenh = String(args.kenh);
    const keyword = typeof args.tu_khoa === "string" ? args.tu_khoa.toLocaleLowerCase("vi") : null;
    const status = typeof args.trang_thai === "string" ? args.trang_thai : null;
    const keep = (name: string, rowStatus: string) => (!keyword || name.toLocaleLowerCase("vi").includes(keyword)) && (!status || rowStatus === status);
    const result: Record<string, unknown> = {};
    if (kenh === "TAT_CA" || kenh === "EMAIL") {
      const { campaigns, error } = await listCampaigns();
      const rows = campaigns.filter((row) => !row.archivedAt && keep(row.name, row.status));
      result.email = error ? { loi: error } : {
        tong: rows.length,
        chien_dich: rows.slice(0, 15).map((row) => ({ id: row.id, ten: row.name, trang_thai: row.status, nguoi_nhan: row.recipients, da_gui: row.sent, follow_up: row.followUps, phan_hoi: row.replies, bounce: row.hardBounces, dang_cho: row.pending, loi: row.failed, chua_xac_dinh: row.deliveryUnknown, phu_trach: row.ownerName, cap_nhat: row.updatedAt, link: `/campaigns/${row.id}` })),
      };
    }
    if (kenh === "TAT_CA" || kenh === "ZALO") {
      const rows = (await listChannelCampaigns()).filter((row) => keep(row.name, row.status));
      result.zalo = { tong: rows.length, chien_dich: rows.slice(0, 15).map((row) => ({ id: row.id, ten: row.name, trang_thai: row.status, nguoi_nhan: row.quantity, da_gui: row.sent, phan_hoi: row.replies, tai_khoan_gui: row.senderNames, phu_trach: row.ownerName, link: `/campaigns/omnichannel/${row.id}` })) };
    }
    if (kenh === "TAT_CA" || kenh === "FACEBOOK_PROFILE") {
      const rows = (await listFacebookProfileCampaigns()).filter((row) => keep(row.name, row.status));
      result.facebook_ca_nhan = { tong: rows.length, chien_dich: rows.slice(0, 15).map((row) => ({ id: row.id, ten: row.name, trang_thai: row.status, nguoi_nhan: row.quantity, da_gui: row.sent, phan_hoi: row.replies, tai_khoan_gui: row.senderNames, phu_trach: row.ownerName, link: `/campaigns/facebook-profile/${row.id}` })) };
    }
    return result;
  },

  async thong_ke_gui_tin() {
    const data = await getChannelDeliveryReport();
    if (data.error) return { loi: data.error };
    return { tong: data.totals, theo_kenh: data.byChannel, bien_nhan_nha_cung_cap: data.hasProviderEvents ? data.report : null, chi_tinh_20000_lenh_gan_nhat: data.truncated, link: "/analytics" };
  },

  async tim_lien_he(args, scope) {
    const supabase = await createClient();
    let query = supabase.from("contacts").select("id,full_name,job_title,email,phone,country,source,lead_status,lead_score,created_at,companies(name)", { count: "exact" }).eq("workspace_id", scope.workspaceId);
    const pattern = typeof args.tu_khoa === "string" ? contactSearchPattern(args.tu_khoa) : null;
    if (pattern) query = query.or(["full_name", "email", "phone", "job_title", "country", "source"].map((column) => `${column}.ilike.${pattern}`).join(","));
    if (typeof args.trang_thai_lead === "string") query = query.eq("lead_status", args.trang_thai_lead);
    const { data, count, error } = await query.order("created_at", { ascending: false }).limit(10);
    if (error) return { loi: "Không tìm được liên hệ." };
    return {
      tong_khop: count ?? (data ?? []).length,
      lien_he: (data ?? []).map((row) => {
        const company = Array.isArray(row.companies) ? row.companies[0] : row.companies as { name: string } | null;
        const hint = [row.source && `nguồn ${row.source}`, company?.name, row.created_at && `tạo ${new Date(row.created_at).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}`, maskEmail(row.email), maskPhone(row.phone)].filter(Boolean).join(" · ");
        return { id: row.id, ten: row.full_name, phan_biet: hint, chuc_danh: row.job_title, cong_ty: company?.name ?? null, email: row.email, dien_thoai: row.phone, quoc_gia: row.country, nguon: row.source, trang_thai_lead: row.lead_status, diem: row.lead_score, link: `/contacts/${row.id}` };
      }),
      link_danh_sach: "/contacts",
    };
  },

  async tim_cong_ty(args, scope) {
    const supabase = await createClient();
    const pattern = contactSearchPattern(String(args.tu_khoa));
    if (!pattern) return { cong_ty: [] };
    const { data, error } = await supabase.from("companies").select("id,name,website,industry,country,status,contacts(count)")
      .eq("workspace_id", scope.workspaceId).or(`name.ilike.${pattern},website.ilike.${pattern}`).order("name").limit(10);
    if (error) return { loi: "Không tìm được công ty." };
    return {
      cong_ty: (data ?? []).map((row) => ({ ten: row.name, website: row.website, nganh: row.industry, quoc_gia: row.country, trang_thai: row.status, so_lien_he: (row.contacts as unknown as { count: number }[] | null)?.[0]?.count ?? null })),
      link: "/companies",
    };
  },

  async cong_viec(args, scope) {
    const supabase = await createClient();
    let query = supabase.from("channel_tasks").select("id,title,status,due_at,assigned_to,conversation_id,created_at").eq("workspace_id", scope.workspaceId);
    if (!args.bao_gom_da_xong) query = query.in("status", ["OPEN", "IN_PROGRESS"]);
    if (args.chi_cua_toi) query = query.eq("assigned_to", scope.userId);
    const { data, error } = await query.order("due_at", { ascending: true, nullsFirst: false }).limit(50);
    if (error) return { loi: "Không tải được công việc." };
    const now = Date.now();
    const rows = data ?? [];
    return {
      tong: rows.length,
      qua_han: rows.filter((row) => row.due_at && Date.parse(row.due_at) < now && (row.status === "OPEN" || row.status === "IN_PROGRESS")).length,
      cong_viec: rows.slice(0, 25).map((row) => ({ tieu_de: clip(row.title, 200), trang_thai: row.status, han: row.due_at, giao_cho_toi: row.assigned_to === scope.userId, link: row.conversation_id ? `/inbox/all/${row.conversation_id}` : "/tasks" })),
      link: "/tasks",
    };
  },

  async kho_mau_content(args, scope) {
    const supabase = await createClient();
    let query = supabase.from("content_templates").select("code,department,group_name,language,weight,body").eq("workspace_id", scope.workspaceId).eq("active", true);
    if (typeof args.bo_phan === "string") query = query.eq("department", args.bo_phan);
    const { data, error } = await query.order("weight", { ascending: false }).order("code").limit(60);
    if (error) return { loi: "Không tải được Kho mẫu." };
    return {
      mau: (data ?? []).map((row) => ({ ma: row.code, bo_phan: row.department, nhom: row.group_name, ngon_ngu: row.language, trong_so: row.weight, doan_dau: clip(row.body.replace(/\s+/g, " "), 140) })),
      link: "/content/templates",
    };
  },

  async kho_content(args, scope) {
    const supabase = await createClient();
    const since = new Date(Date.now() - 7 * 24 * HOUR).toISOString();
    const pattern = typeof args.tu_khoa === "string" ? contentSearchPattern(args.tu_khoa) : null;
    let items = supabase.from("content_items").select("id,code,title,job_title,department,content_format,created_at", { count: "exact" }).eq("workspace_id", scope.workspaceId);
    if (pattern) items = items.or(["code", "title", "job_title"].map((column) => `${column}.ilike.${pattern}`).join(","));
    const [itemResult, batches] = await Promise.all([
      items.order("created_at", { ascending: false }).limit(10),
      supabase.from("content_batches").select("job_title,department,quantity,status,saved_count,rejected_count,error_code,created_at").eq("workspace_id", scope.workspaceId).gte("created_at", since).order("created_at", { ascending: false }).limit(20),
    ]);
    if (itemResult.error) return { loi: "Không tải được Kho content." };
    return {
      tong_content_khop: itemResult.count ?? 0,
      content: (itemResult.data ?? []).map((row) => ({ ma: row.code, tieu_de: row.title, job: row.job_title, bo_phan: row.department, dinh_dang: row.content_format, tao_luc: row.created_at, link: `/content?q=${encodeURIComponent(row.code)}` })),
      yeu_cau_7_ngay: (batches.data ?? []).map((row) => ({ job: row.job_title, bo_phan: row.department, so_luong: row.quantity, trang_thai: row.status, da_luu: row.saved_count, bi_loai: row.rejected_count, ma_loi: row.error_code, luc: row.created_at })),
      link: "/content",
    };
  },
};

/** Runs one read-only tool directly (used by the daily brief). */
export async function runReadTool(name: string, args: Record<string, unknown>, scope: ToolScope): Promise<unknown> {
  const runner = runners[name];
  if (!runner) throw new Error("UNKNOWN_TOOL");
  return runner(args, scope);
}

export async function runAssistantTool(tool: AssistantToolDefinition, args: Record<string, unknown>, scope: ToolScope): Promise<unknown> {
  if (tool.proposal) return createProposal(tool.name, args, scope.context, scope.proposals);
  const runner = runners[tool.name];
  if (!runner) throw new Error("UNKNOWN_TOOL");
  return runner(args, scope);
}

export const IMPLEMENTED_TOOLS = Object.keys(runners);
// Proposal tools (de_xuat_*) are implemented in assistant-proposals.ts.
