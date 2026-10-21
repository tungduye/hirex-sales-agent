import "server-only";

import { createClient } from "@/lib/supabase/server";
import { kpiRange, type KpiPeriod } from "@/modules/assistant/core/kpi-range";
import { fold } from "@/modules/customers/core/partner-parse";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// Màn CV (copied from Human) for Soda, with the member's own session: row level security keeps it to the CVs
// they may see ("Xem tất cả CV", or the ones they are Rec of).

type Scope = { workspaceId: string; userId: string; context: ActionContext; channel?: "WEB" | "ZALO" };
const str = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const day = (value: unknown) => typeof value === "string" ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value)) : null;
const GROUPS: Record<string, string> = { TINH_TRANG: "status2", TRANG_THAI: "status1", VI_TRI: "position", KY_NANG: "skill", DIA_DIEM: "location", REC: "recer", NGOAI_NGU: "languages", KHOI: "block" };

async function scopeOf(scope: Scope, mineOnly: boolean) {
  if (!scope.context.permissions.includes("cvs.view")) return { error: "Sếp chưa có quyền CV · Xem." };
  const db = await createClient();
  const { data: links } = await db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", scope.workspaceId);
  const mine = (links ?? []).filter((link) => link.profile_id === scope.userId).map((link) => String(link.human_user_id));
  if (mineOnly && !mine.length) return { error: "Sếp chưa được liên kết với Rec nào trên Human (admin liên kết ở CV → Cài đặt)." };
  const { data: profiles } = await db.from("profiles").select("id,full_name").eq("workspace_id", scope.workspaceId);
  const profileName = new Map((profiles ?? []).map((row) => [String(row.id), String(row.full_name ?? "")]));
  const names = new Map((links ?? []).flatMap((link) => { const name = (link.profile_id && profileName.get(String(link.profile_id))) || link.human_name; return name ? [[String(link.human_user_id), String(name)] as const] : []; }));
  return { db, mine, names, all: scope.context.permissions.includes("cvs.view_all") };
}

export const cvTools: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async tim_cv(args, scope) {
    const seen = await scopeOf(scope, args.chi_cua_toi === true);
    if ("error" in seen) return { loi: seen.error };
    const limit = Math.min(Math.max(Number(args.so_luong) || 10, 1), 30);
    let query = seen.db.from("human_cvs").select("cv_id,code,name,phone,email,position,skill,skill_tech,languages,location,status1,status2,recer_human_id,recer_name,companies,salary,human_created_at,human_updated_at,applications", { count: "exact" })
      .eq("workspace_id", scope.workspaceId).eq("active", true);
    const keyword = str(args.tu_khoa);
    const byContact = Boolean(keyword && (/@/u.test(keyword) || /^[+\d\s.-]{9,}$/u.test(keyword)));
    if (keyword) {
      const digits = keyword.replace(/\D/gu, "");
      const phone = /^0\d{9}$/u.test(digits) ? `84${digits.slice(1)}` : /^84\d{9}$/u.test(digits) ? digits : null;
      query = phone ? query.contains("phone_keys", [phone]) : query.ilike("search_text", `%${fold(keyword).replace(/[%_\\]/gu, "")}%`);
    }
    for (const [column, value] of [["status2", str(args.trang_thai)], ["position", str(args.vi_tri)]] as const) if (value) query = query.ilike(column, `%${value.replace(/[%_\\]/gu, "")}%`);
    if (args.chi_cua_toi === true) query = query.in("recer_human_id", seen.mine);
    const { data, count, error } = await query.order("cv_id", { ascending: false }).limit(limit);
    if (error) return { loi: "Chưa đọc được danh sách CV." };
    return {
      tong: count ?? 0, pham_vi: seen.all && args.chi_cua_toi !== true ? "tất cả CV" : "CV sếp là Rec phụ trách",
      cv: (data ?? []).map((row) => ({
        ten: row.name, ma: row.code, vi_tri: row.position, ky_nang: [row.skill, row.skill_tech].filter(Boolean).join(" · ") || null, ngoai_ngu: row.languages, dia_diem: row.location,
        trang_thai: [row.status1, row.status2].filter(Boolean).join(" · ") || null, rec: row.recer_human_id ? seen.names.get(String(row.recer_human_id)) ?? row.recer_name ?? `#${row.recer_human_id}` : row.recer_name,
        luong: row.salary,
        da_gui_cong_ty: ((row.applications ?? []) as Array<{ partner_name: string | null; status2: string | null; status2_at: string | null; updated_at: string | null }>).slice(0, 15)
          .map((item) => ({ cong_ty: item.partner_name, tinh_trang: item.status2, ngay: day(item.status2_at ?? item.updated_at) })),
        ...(byContact ? { sdt: row.phone, email: row.email } : {}), tao: day(row.human_created_at), cap_nhat: day(row.human_updated_at), link: `/cvs?id=${row.cv_id}`,
      })),
      ghi_chu: "Màn CV là bản sao CV trên Human (cập nhật mỗi 6 giờ). SĐT/email chỉ đưa khi người dùng tìm theo SĐT/email.",
      link: "/cvs",
    };
  },

  async thong_ke_cv(args, scope) {
    const seen = await scopeOf(scope, args.chi_cua_toi === true);
    if ("error" in seen) return { loi: seen.error };
    const by = GROUPS[str(args.nhom_theo) ?? "TINH_TRANG"] ?? "status2";
    let from: Date | null = null, to: Date | null = null, label: string | null = null;
    const ky = str(args.ky) === "TAT_CA" ? null : str(args.ky);
    if (ky || str(args.tu_ngay) || str(args.den_ngay)) {
      const range = kpiRange(ky as KpiPeriod | null, str(args.tu_ngay), str(args.den_ngay));
      if ("error" in range) return { loi: range.error };
      ({ from, to, label } = range);
    }
    const search = str(args.loc) ? fold(String(args.loc)).replace(/[%_\\]/gu, "") : null;
    const { data, error } = await seen.db.rpc("human_cv_stats", { p_group: by, p_from: from?.toISOString() ?? null, p_to: to?.toISOString() ?? null, p_search: search, p_recers: args.chi_cua_toi === true ? seen.mine : null });
    if (error) return { loi: "Chưa thống kê được CV." };
    const rows = ((data ?? []) as Array<{ value: string; total: number }>).map((row) => ({ gia_tri: row.value ? (by === "recer" ? seen.names.get(row.value) ?? `#${row.value}` : row.value) : "(trống)", so_cv: Number(row.total) }));
    return {
      pham_vi: seen.all && args.chi_cua_toi !== true ? "tất cả CV" : "CV sếp là Rec phụ trách", ...(label ? { cv_tao_trong: label } : {}), ...(search ? { loc: args.loc } : {}),
      tong_cv: rows.reduce((sum, row) => sum + row.so_cv, 0), nhom_theo: str(args.nhom_theo) ?? "TINH_TRANG", nhom: rows.slice(0, 60), link: "/cvs",
    };
  },
};
