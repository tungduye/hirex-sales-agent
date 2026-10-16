import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { getAccessibleChannelAccountIds } from "@/modules/access/server/access-control";
import { pageLink, type PageFilters, type PageKey } from "@/modules/assistant/core/page-links";
import { getCampaignDetail } from "@/modules/campaigns/server/campaign-data";
import { getChannelCampaign } from "@/modules/channels/server/get-channel-campaign-data";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// Phase 2 read tools: details behind the list tools, and links to pages. Read only. Each tool is
// offered only to members holding its permission (assistant-tools.ts); parts that need another
// permission (e.g. conversations inside a contact) are checked again here and left out otherwise.

type Scope = { workspaceId: string; userId: string; context: ActionContext };
type Row = Record<string, unknown>;

const clip = (value: unknown, max = 300) => typeof value === "string" ? (value.length > max ? `${value.slice(0, max)}…` : value) : null;
const str = (value: unknown) => typeof value === "string" && value.trim() ? value : null;
const can = (scope: Scope, permission: string) => scope.context.isAdmin || scope.context.permissions.includes(permission);
const one = <T,>(value: T | T[] | null | undefined) => Array.isArray(value) ? value[0] ?? null : value ?? null;
const countBy = (values: string[]) => values.reduce<Record<string, number>>((acc, value) => { acc[value] = (acc[value] ?? 0) + 1; return acc; }, {});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names of campaigns a set of content items was used for. */
async function campaignNames(workspaceId: string, usages: Row[]) {
  const db = createPrivilegedClient();
  const emailIds = usages.filter((row) => row.campaign_kind === "EMAIL").map((row) => String(row.campaign_id));
  const channelIds = usages.filter((row) => row.campaign_kind === "CHANNEL").map((row) => String(row.campaign_id));
  const [email, channel] = await Promise.all([
    emailIds.length ? db.from("email_campaigns").select("id,name").eq("workspace_id", workspaceId).in("id", emailIds) : Promise.resolve({ data: [] }),
    channelIds.length ? db.from("channel_campaigns").select("id,name").eq("workspace_id", workspaceId).in("id", channelIds) : Promise.resolve({ data: [] }),
  ]);
  return new Map([...(email.data ?? []), ...(channel.data ?? [])].map((row: Row) => [String(row.id), String(row.name ?? "")]));
}

export const readTools2: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async mo_trang(args, scope) {
    const filters: PageFilters = { tu_khoa: str(args.tu_khoa), trang_thai: str(args.trang_thai), kenh: str(args.kenh), dinh_dang: str(args.dinh_dang), bo_phan: str(args.bo_phan), ngon_ngu: str(args.ngon_ngu) };
    return pageLink(String(args.trang) as PageKey, filters, { permissions: scope.context.permissions, isAdmin: scope.context.isAdmin });
  },

  async chi_tiet_lien_he(args, scope) {
    const supabase = await createClient();
    const id = String(args.contact_id);
    const { data: contact, error } = await supabase.from("contacts")
      .select("id,full_name,job_title,email,phone,country,language,source,lead_status,lead_score,notes,created_at,updated_at,company_id,companies(id,name)")
      .eq("workspace_id", scope.workspaceId).eq("id", id).maybeSingle();
    if (error) return { loi: "Không tải được liên hệ." };
    if (!contact) return { loi: "Không tìm thấy liên hệ (hoặc không có quyền xem)." };
    const db = createPrivilegedClient();
    const canInbox = can(scope, "inbox.view");
    const canCampaigns = can(scope, "campaigns.view");
    const [channels, notes, conversations, accessible, emailCampaigns, channelCampaigns] = await Promise.all([
      supabase.from("contact_channels").select("channel_type,channel_value,is_primary,marketing_consent_status").eq("workspace_id", scope.workspaceId).eq("contact_id", id).order("is_primary", { ascending: false }),
      db.from("notes").select("content,created_by,created_at").eq("workspace_id", scope.workspaceId).eq("contact_id", id).order("created_at", { ascending: false }).limit(5),
      canInbox ? db.from("omnichannel_conversations").select("id,channel_type,channel_account_id,last_message_at,unread_count").eq("workspace_id", scope.workspaceId).eq("contact_id", id).order("last_message_at", { ascending: false, nullsFirst: false }).limit(15) : Promise.resolve({ data: [] }),
      canInbox ? getAccessibleChannelAccountIds() : Promise.resolve([] as string[]),
      canCampaigns ? db.from("email_campaign_recipients").select("campaign_id,status,sent_at,email_campaigns(name,status)").eq("workspace_id", scope.workspaceId).eq("contact_id", id).order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
      canCampaigns ? db.from("channel_campaign_recipients").select("campaign_id,status,replied_at,channel_campaigns(name,status)").eq("workspace_id", scope.workspaceId).eq("contact_id", id).order("created_at", { ascending: false }).limit(10) : Promise.resolve({ data: [] }),
    ]);
    // Only conversations on channel accounts this member may see.
    const visible = ((conversations.data ?? []) as Row[]).filter((row) => accessible === null || accessible.includes(String(row.channel_account_id))).slice(0, 8);
    const conversationIds = visible.map((row) => String(row.id));
    const noteRows = (notes.data ?? []) as Row[];
    const [tasks, authors] = await Promise.all([
      can(scope, "tasks.view") && conversationIds.length ? db.from("channel_tasks").select("title,status,due_at,conversation_id").eq("workspace_id", scope.workspaceId).in("conversation_id", conversationIds).in("status", ["OPEN", "IN_PROGRESS"]).order("due_at", { ascending: true, nullsFirst: false }).limit(10) : Promise.resolve({ data: [] }),
      noteRows.length ? db.from("profiles").select("id,full_name").eq("workspace_id", scope.workspaceId).in("id", [...new Set(noteRows.map((row) => String(row.created_by)))]) : Promise.resolve({ data: [] }),
    ]);
    const authorNames = new Map(((authors.data ?? []) as Row[]).map((row) => [String(row.id), String(row.full_name ?? "")]));
    const company = one(contact.companies as Row | Row[] | null);
    return {
      id: contact.id, ten: contact.full_name, chuc_danh: contact.job_title, email: contact.email, sdt: contact.phone, quoc_gia: contact.country, ngon_ngu: contact.language,
      nguon: contact.source, trang_thai_lead: contact.lead_status, diem_lead: contact.lead_score, ghi_chu_lien_he: clip(contact.notes, 600),
      cong_ty: company ? { id: company.id, ten: company.name } : null, tao_luc: contact.created_at, cap_nhat: contact.updated_at,
      kenh_lien_lac: ((channels.data ?? []) as Row[]).map((row) => ({ kenh: row.channel_type, gia_tri: row.channel_value, chinh: row.is_primary, dong_y_marketing: row.marketing_consent_status })),
      ghi_chu_noi_bo: noteRows.map((row) => ({ noi_dung: clip(row.content, 400), nguoi_viet: authorNames.get(String(row.created_by)) ?? null, luc: row.created_at })),
      ...(canInbox ? { hoi_thoai: visible.map((row) => ({ id: row.id, kenh: row.channel_type, tin_cuoi: row.last_message_at, chua_doc: row.unread_count, link: `/inbox/all/${row.id}` })) } : {}),
      ...(can(scope, "tasks.view") ? { cong_viec_dang_mo: ((tasks.data ?? []) as Row[]).map((row) => ({ tieu_de: row.title, trang_thai: row.status, han: row.due_at })) } : {}),
      ...(canCampaigns ? {
        chien_dich_email: ((emailCampaigns.data ?? []) as Row[]).map((row) => ({ ten: one(row.email_campaigns as Row | Row[] | null)?.name ?? null, trang_thai_gui: row.status, gui_luc: row.sent_at, link: `/campaigns/${row.campaign_id}` })),
        chien_dich_kenh: ((channelCampaigns.data ?? []) as Row[]).map((row) => ({ ten: one(row.channel_campaigns as Row | Row[] | null)?.name ?? null, trang_thai: row.status, tra_loi_luc: row.replied_at, link: `/campaigns/omnichannel/${row.campaign_id}` })),
      } : {}),
      link: `/contacts/${contact.id}`,
    };
  },

  async chi_tiet_cong_ty(args, scope) {
    const supabase = await createClient();
    const id = String(args.company_id);
    const { data: company, error } = await supabase.from("companies").select("id,name,website,industry,country,status,notes,created_at,updated_at").eq("workspace_id", scope.workspaceId).eq("id", id).maybeSingle();
    if (error) return { loi: "Không tải được công ty." };
    if (!company) return { loi: "Không tìm thấy công ty (hoặc không có quyền xem)." };
    let contacts: Record<string, unknown> = {};
    if (can(scope, "contacts.view")) {
      const { data, count } = await supabase.from("contacts").select("id,full_name,job_title,lead_status,created_at", { count: "exact" }).eq("workspace_id", scope.workspaceId).eq("company_id", id).order("created_at", { ascending: false }).limit(500);
      const rows = (data ?? []) as Row[];
      contacts = {
        tong_lien_he: count ?? rows.length,
        theo_trang_thai_lead: countBy(rows.map((row) => String(row.lead_status))),
        lien_he_moi_nhat: rows.slice(0, 15).map((row) => ({ id: row.id, ten: row.full_name, chuc_danh: row.job_title, trang_thai_lead: row.lead_status, link: `/contacts/${row.id}` })),
      };
    }
    return { id: company.id, ten: company.name, website: company.website, nganh: company.industry, quoc_gia: company.country, trang_thai: company.status, ghi_chu: clip(company.notes, 800), tao_luc: company.created_at, cap_nhat: company.updated_at, ...contacts, link: "/companies" };
  },

  async chi_tiet_chien_dich(args, scope) {
    const id = String(args.campaign_id);
    const kenh = typeof args.kenh === "string" ? args.kenh : null;
    const db = createPrivilegedClient();
    const contentFor = async (kind: "EMAIL" | "CHANNEL") => {
      const { data: usages } = await db.from("content_item_usages").select("content_item_id").eq("workspace_id", scope.workspaceId).eq("campaign_kind", kind).eq("campaign_id", id);
      const ids = ((usages ?? []) as Row[]).map((row) => String(row.content_item_id));
      if (!ids.length) return [];
      const { data } = await db.from("content_items").select("code,title").eq("workspace_id", scope.workspaceId).in("id", ids);
      return ((data ?? []) as Row[]).map((row) => ({ ma: row.code, tieu_de: row.title, link: `/content?q=${encodeURIComponent(String(row.code))}` }));
    };

    if (kenh === null || kenh === "EMAIL") {
      const campaign = await getCampaignDetail(id) as Row | null;
      if (campaign) {
        const statuses = ["PENDING", "SENDING", "SENT", "FAILED", "SUPPRESSED", "CANCELLED", "DELIVERY_UNKNOWN"];
        const [counts, failures, content] = await Promise.all([
          Promise.all(statuses.map((status) => db.from("email_campaign_recipients").select("id", { count: "exact", head: true }).eq("workspace_id", scope.workspaceId).eq("campaign_id", id).eq("status", status))),
          db.from("email_campaign_recipients").select("safe_error_code").eq("workspace_id", scope.workspaceId).eq("campaign_id", id).eq("status", "FAILED").limit(500),
          contentFor("EMAIL"),
        ]);
        const errors = countBy(((failures.data ?? []) as Row[]).map((row) => String(row.safe_error_code ?? "KHONG_RO")));
        const steps = ((campaign.email_campaign_steps ?? []) as Row[]).sort((a, b) => Number(a.step_order) - Number(b.step_order));
        const events = ((campaign.email_campaign_events ?? []) as Row[]).map((row) => String(row.event_type));
        return {
          kenh: "EMAIL", id: campaign.id, ten: campaign.name, trang_thai: campaign.status, luu_tru: Boolean(campaign.archived_at), chuoi_follow_up: campaign.sequence_enabled,
          phu_trach: campaign.owner_name, combo_uv: campaign.combo_uv, vi_tri_dang: campaign.placement, hang_kenh: campaign.channel_rank,
          moc: { len_lich: campaign.scheduled_at, bat_dau: campaign.started_at, tam_dung: campaign.paused_at, hoan_thanh: campaign.completed_at, huy: campaign.cancelled_at },
          nguoi_nhan_theo_trang_thai: Object.fromEntries(statuses.map((status, index) => [status, counts[index].count ?? 0])),
          loi_thuong_gap: Object.entries(errors).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ma, so]) => ({ ma, so })),
          cac_buoc: (steps.length ? steps : [{ step_order: 0, step_type: "INITIAL", delay_minutes: 0, subject_template: campaign.subject_template, body_text_template: campaign.body_text_template, enabled: true }]).map((step) => ({
            thu_tu: step.step_order, loai: step.step_type, cho_phut: step.delay_minutes, bat: step.enabled, tieu_de: clip(step.subject_template, 200), noi_dung_rut_gon: clip(step.body_text_template, 400),
          })),
          so_tai_khoan_gui: ((campaign.email_campaign_senders ?? []) as Row[]).filter((row) => row.enabled !== false).length,
          su_kien_gan_day: countBy(events),
          content_tu_kho: content,
          link: `/campaigns/${campaign.id}`,
        };
      }
      if (kenh === "EMAIL") return { loi: "Không tìm thấy chiến dịch email này." };
    }

    const data = await getChannelCampaign(id);
    if (!data) return { loi: "Không tìm thấy chiến dịch (hoặc không có quyền xem)." };
    const campaign = data.campaign as Row;
    const steps = data.steps as Row[];
    const facebook = steps.some((step) => Array.isArray(step.allowed_channels) && step.allowed_channels.includes("FACEBOOK_PROFILE"));
    const [sent, failed, unknown] = data.deliveryCounts;
    return {
      kenh: facebook ? "FACEBOOK_PROFILE" : "ZALO", id: campaign.id, ten: campaign.name, trang_thai: campaign.status, dung_khi_tra_loi: campaign.stop_on_reply,
      moc: { tao: campaign.created_at, bat_dau: campaign.started_at, hoan_thanh: campaign.completed_at, luot_tiep_theo: campaign.pacing_next_at },
      gioi_han: { tin_moi_ngay: campaign.daily_message_limit, cach_nhau_giay: [campaign.min_delay_seconds, campaign.max_delay_seconds], moi_dot: campaign.batch_size, nghi_giua_dot_phut: campaign.batch_pause_minutes },
      nguoi_nhan: data.recipients.length, nguoi_nhan_theo_trang_thai: countBy(data.recipients.map((row) => row.status)),
      ly_do_dung_hoac_loi: Object.entries(countBy(data.recipients.filter((row) => row.status === "FAILED" || row.status === "DELIVERY_UNKNOWN" || row.status === "SUPPRESSED").map((row) => `${row.status}: ${row.stop_reason ?? "KHONG_RO"}`)))
        .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ly_do, so]) => ({ ly_do, so })),
      tin_da_gui: sent, tin_loi: failed, tin_chua_xac_dinh: unknown,
      cac_buoc: steps.map((step) => ({ thu_tu: step.position, cho_phut: step.delay_minutes, kenh: step.allowed_channels, noi_dung_rut_gon: clip(step.text_template, 400), so_bien_the: Array.isArray(step.content_variants) ? step.content_variants.length : 0 })),
      tai_khoan_gui: (data.senders as Row[]).map((row) => one(row.channel_accounts as Row | Row[] | null)?.display_name ?? null),
      su_kien_gan_day: countBy((data.events as Row[]).map((row) => String(row.event_type))),
      content_tu_kho: await contentFor("CHANNEL"),
      link: facebook ? `/campaigns/facebook-profile/${campaign.id}` : `/campaigns/omnichannel/${campaign.id}`,
    };
  },

  async doc_content(args, scope) {
    const supabase = await createClient();
    const key = String(args.ma).trim();
    let query = supabase.from("content_items").select("id,code,title,body,job_title,content_format,department,category_id,content_language,created_at").eq("workspace_id", scope.workspaceId);
    query = UUID.test(key) ? query.eq("id", key) : query.ilike("code", key.toUpperCase().replace(/[%_]/g, ""));
    const { data: item, error } = await query.maybeSingle();
    if (error) return { loi: "Không tải được content." };
    if (!item) return { loi: `Không có content mã ${key}. Dùng kho_content để tìm đúng mã.` };
    const [category, usage] = await Promise.all([
      item.category_id ? supabase.from("content_categories").select("name").eq("workspace_id", scope.workspaceId).eq("id", item.category_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("content_item_usages").select("campaign_kind,campaign_id,used_at").eq("workspace_id", scope.workspaceId).eq("content_item_id", item.id).maybeSingle(),
    ]);
    const used = usage.data as Row | null;
    const names = used ? await campaignNames(scope.workspaceId, [used]) : new Map<string, string>();
    return {
      ma: item.code, tieu_de: item.title, noi_dung: clip(item.body, 6000), job: item.job_title, dinh_dang: item.content_format, bo_phan: item.department,
      phan_loai: (category.data as Row | null)?.name ?? null, ngon_ngu: item.content_language, tao_luc: item.created_at,
      da_dung_cho: used ? { loai: used.campaign_kind, ten_chien_dich: names.get(String(used.campaign_id)) ?? null, luc: used.used_at, link: used.campaign_kind === "EMAIL" ? `/campaigns/${used.campaign_id}` : `/campaigns/omnichannel/${used.campaign_id}` } : null,
      link: `/content?q=${encodeURIComponent(String(item.code))}`,
    };
  },

  async content_chua_dung(args) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_available_content_items", {
      p_format: typeof args.dinh_dang === "string" ? args.dinh_dang : null,
      p_department: typeof args.bo_phan === "string" ? args.bo_phan : null,
      p_category_id: null,
      p_language: typeof args.ngon_ngu === "string" ? args.ngon_ngu : null,
      p_limit: typeof args.so_luong === "number" ? args.so_luong : 10,
    });
    if (error) return { loi: "Không tải được Kho content." };
    const rows = (data ?? []) as Row[];
    return {
      so_tim_thay: rows.length,
      content: rows.map((row) => ({ ma: row.code, tieu_de: row.title, job: row.job_title, dinh_dang: row.content_format, bo_phan: row.department, ngon_ngu: row.content_language, tao_luc: row.created_at, doan_dau: clip(String(row.body ?? "").replace(/\s+/g, " "), 160), link: `/content?q=${encodeURIComponent(String(row.code))}` })),
      ghi_chu: "Chỉ gồm content chưa gắn với chiến dịch nào. Lấy content vào chiến dịch ở nút \"Lấy từ Kho content\" khi tạo chiến dịch.",
    };
  },

  async thanh_vien_vai_tro(_args, scope) {
    const db = createPrivilegedClient();
    const [profiles, roles, permissions, access] = await Promise.all([
      db.from("profiles").select("id,full_name,role_id,all_channel_accounts").eq("workspace_id", scope.workspaceId).order("full_name"),
      db.from("workspace_roles").select("id,name,description,is_system").eq("workspace_id", scope.workspaceId).order("name"),
      db.from("workspace_role_permissions").select("role_id,permission_key").eq("workspace_id", scope.workspaceId),
      db.from("profile_channel_account_access").select("profile_id").eq("workspace_id", scope.workspaceId),
    ]);
    if (profiles.error || roles.error) return { loi: "Không tải được thành viên và vai trò." };
    const roleRows = (roles.data ?? []) as Row[];
    const roleNames = new Map(roleRows.map((row) => [String(row.id), String(row.name)]));
    const accessCount = countBy(((access.data ?? []) as Row[]).map((row) => String(row.profile_id)));
    const memberRows = (profiles.data ?? []) as Row[];
    const membersPerRole = countBy(memberRows.map((row) => String(row.role_id ?? "")));
    return {
      thanh_vien: memberRows.map((row) => ({ ten: row.full_name, vai_tro: roleNames.get(String(row.role_id)) ?? "(chưa có vai trò)", tai_khoan_ket_noi: row.all_channel_accounts ? "Tất cả" : `${accessCount[String(row.id)] ?? 0} tài khoản được cấp` })),
      vai_tro: roleRows.map((row) => ({
        ten: row.name, mo_ta: row.description, he_thong: row.is_system, so_thanh_vien: membersPerRole[String(row.id)] ?? 0,
        quyen: ((permissions.data ?? []) as Row[]).filter((item) => item.role_id === row.id).map((item) => String(item.permission_key)).sort(),
      })),
      link: "/settings/roles",
    };
  },
};
