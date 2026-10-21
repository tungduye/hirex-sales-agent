import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { fold } from "@/modules/customers/core/partner-parse";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// "khach_hang": the Khách hàng list (copied from Human), within the member's rights: "Xem tất cả khách", or
// only customers where they are Sale / AM. Works the same on the web and on Zalo (no browser session there).

type Scope = { workspaceId: string; userId: string; context: ActionContext; channel?: "WEB" | "ZALO" };

export const customerTools: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async khach_hang(args, scope) {
    const permissions = scope.context.permissions;
    if (!permissions.includes("customers.view")) return { loi: "Bạn chưa có quyền Khách hàng · Xem." };
    const db = createPrivilegedClient();
    const { data: links } = await db.from("human_user_links").select("human_user_id,profile_id").eq("workspace_id", scope.workspaceId);
    const mine = (links ?? []).filter((link) => link.profile_id === scope.userId).map((link) => String(link.human_user_id).replace(/[^A-Za-z0-9_.@-]/gu, ""));
    const onlyMine = args.chi_cua_toi === true || !permissions.includes("customers.view_all");
    if (onlyMine && !mine.length) return { tong: 0, ghi_chu: "Bạn chưa được liên kết với Sale/AM nào trên Human (admin liên kết ở Khách hàng → Cài đặt).", link: "/customers" };
    const limit = Math.min(Math.max(Number(args.so_luong) || 10, 1), 30);
    let query = db.from("human_partners").select("partner_id,name,location,website,project_rank,job_rank,am_rank,am_rank2,sale_human_id,am_human_id,cv_total,cv_sent,cv_processing,cv_offer,cv_done,last_note,last_note_at,contact_name,email,phone,block_ids", { count: "exact" })
      .eq("workspace_id", scope.workspaceId).eq("active", true);
    if (onlyMine) query = query.or(`sale_human_id.in.(${mine.join(",")}),am_human_id.in.(${mine.join(",")}),am2_human_id.in.(${mine.join(",")})`);
    if (typeof args.tu_khoa === "string" && args.tu_khoa.trim()) query = query.ilike("search_text", `%${fold(args.tu_khoa).replace(/[%_\\]/gu, "")}%`);
    if (typeof args.trang_thai === "string" && args.trang_thai.trim()) { const pattern = `%${args.trang_thai.trim().replace(/[%_\\,()]/gu, "")}%`; query = query.or(`project_rank.ilike.${pattern},am_rank.ilike.${pattern},am_rank2.ilike.${pattern},job_rank.ilike.${pattern}`); }
    if (Number.isSafeInteger(Number(args.khoi)) && Number(args.khoi) > 0) query = query.contains("block_ids", [Number(args.khoi)]);
    if (args.chua_gui_email === true) query = query.or("cv_sent.is.null,cv_sent.eq.0");
    const { data, count, error } = await query.order("partner_id", { ascending: false }).limit(limit);
    if (error) return { loi: "Chưa đọc được danh sách khách hàng." };
    // Sale / AM: the linked HireX member's name when there is one.
    const profileIds = [...new Set((links ?? []).flatMap((link) => link.profile_id ? [String(link.profile_id)] : []))];
    const { data: profiles } = profileIds.length ? await db.from("profiles").select("id,full_name").eq("workspace_id", scope.workspaceId).in("id", profileIds) : { data: [] };
    const profileName = new Map((profiles ?? []).map((row) => [String(row.id), String(row.full_name ?? "")]));
    const names = new Map((links ?? []).flatMap((link) => link.profile_id && profileName.get(String(link.profile_id)) ? [[String(link.human_user_id), profileName.get(String(link.profile_id))!] as const] : []));
    return {
      tong: count ?? 0, pham_vi: onlyMine ? "khách bạn là Sale/AM" : "tất cả khách",
      khach: (data ?? []).map((row) => ({ ma: row.partner_id, ten: row.name, dia_diem: row.location, website: row.website, xep_hang_du_an: row.project_rank, hang: row.job_rank,
        xep_hang_am: [row.am_rank2, row.am_rank].filter(Boolean).join("; ") || null, sale: names.get(String(row.sale_human_id)) ?? row.sale_human_id, am: names.get(String(row.am_human_id)) ?? row.am_human_id,
        cv: { tong: row.cv_total, da_gui: row.cv_sent, dang_xu_ly: row.cv_processing, offer: row.cv_offer, xong: row.cv_done }, ghi_chu_moi_nhat: row.last_note ? `${row.last_note_at ?? ""} ${row.last_note}`.trim() : null,
        lien_he: row.contact_name, email: row.email, sdt: row.phone, khoi: row.block_ids, link: `/customers?id=${row.partner_id}` })),
      link: "/customers",
    };
  },
};
