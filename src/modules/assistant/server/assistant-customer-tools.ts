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
    let query = db.from("human_partners").select("partner_id,name,partner_type,status,contact_name,position,email,phone,website,address,sale_name,am_name,email_sent_at,block_ids", { count: "exact" })
      .eq("workspace_id", scope.workspaceId).eq("active", true);
    if (onlyMine) query = query.or(`sale_human_id.in.(${mine.join(",")}),am_human_id.in.(${mine.join(",")}),am2_human_id.in.(${mine.join(",")})`);
    if (typeof args.tu_khoa === "string" && args.tu_khoa.trim()) query = query.ilike("search_text", `%${fold(args.tu_khoa).replace(/[%_\\]/gu, "")}%`);
    if (typeof args.trang_thai === "string" && args.trang_thai.trim()) query = query.ilike("status", `%${args.trang_thai.trim().replace(/[%_\\]/gu, "")}%`);
    if (Number.isSafeInteger(Number(args.khoi)) && Number(args.khoi) > 0) query = query.contains("block_ids", [Number(args.khoi)]);
    if (args.chua_gui_email === true) query = query.is("email_sent_at", null);
    const { data, count, error } = await query.order("partner_id", { ascending: false }).limit(limit);
    if (error) return { loi: "Chưa đọc được danh sách khách hàng." };
    return {
      tong: count ?? 0, pham_vi: onlyMine ? "khách bạn là Sale/AM" : "tất cả khách",
      khach: (data ?? []).map((row) => ({ ma: row.partner_id, ten: row.name, loai: row.partner_type, trang_thai: row.status, lien_he: [row.contact_name, row.position].filter(Boolean).join(" · ") || null,
        email: row.email, sdt: row.phone, website: row.website, dia_chi: row.address, sale: row.sale_name, am: row.am_name, gui_email: row.email_sent_at, khoi: row.block_ids, link: `/customers?id=${row.partner_id}` })),
      link: "/customers",
    };
  },
};
