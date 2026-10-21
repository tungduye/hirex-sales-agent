import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { kpiRange, type KpiPeriod } from "@/modules/assistant/core/kpi-range";
import { fold } from "@/modules/customers/core/partner-parse";
import {
  blockLabel, countBy, CV_KIND_LABEL, cvDay, enteredAt, gatherCvs, humanTime, inRange, interviewRound, resolveBlocks, statusMatches, topValues,
  type Block, type CvKind, type GroupBy, type PartnerStatRow,
} from "@/modules/customers/core/customer-stats";
import type { ActionContext } from "@/modules/assistant/server/assistant-proposals";

// Soda, đợt 1, on Khách hàng (copied from Human), within the member's rights ("Xem tất cả khách", or only
// the customers they are Sale / AM of):
//  - thong_ke_khach_hang: how many companies per Hạng / Xếp hạng / khối / …, and which are new in a block.
//  - tong_hop_cv: CVs over many companies from the stored Tình trạng CV (interviews by day and round, waiting…).

type Scope = { workspaceId: string; userId: string; context: ActionContext; channel?: "WEB" | "ZALO" };
type Db = ReturnType<typeof createPrivilegedClient>;
const str = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const vnDay = (ms: number) => Number.isFinite(ms) ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(ms)) : null;
const vnDayTime = (ms: number) => Number.isFinite(ms) ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(ms)) : null;
const COLUMNS = "partner_id,name,block_ids,project_rank,job_rank,am_ranks,am_rank,am_rank2,location,sale_human_id,sale_name,am_human_id,am_name,am2_human_id,cv_total,cv_sent,cv_offer,cv_done,human_created_at,block_seen";
type Partner = PartnerStatRow & { am_rank: string | null; am_rank2: string | null; am2_human_id: string | null; human_created_at: string | null; block_seen: unknown };

export async function loadBlocks(db: Db, workspaceId: string): Promise<Block[]> {
  const { data } = await db.from("human_partner_blocks").select("block_id,name,sort").eq("workspace_id", workspaceId).order("sort");
  return ((data ?? []) as Array<{ block_id: number; name: string | null }>).map((row) => ({ block_id: Number(row.block_id), name: row.name }));
}

/** The customers this member may see, optionally only theirs, in some blocks, with a ranking text. */
async function visiblePartners(scope: Scope, filter: { blocks: Block[] | null; rank: string | null; mineOnly: boolean; company?: string | null }) {
  const permissions = scope.context.permissions;
  if (!permissions.includes("customers.view")) return { error: "Bạn chưa có quyền Khách hàng · Xem." };
  const db = createPrivilegedClient();
  const { data: links } = await db.from("human_user_links").select("human_user_id,human_name,profile_id").eq("workspace_id", scope.workspaceId);
  const mine = (links ?? []).filter((link) => link.profile_id === scope.userId).map((link) => String(link.human_user_id));
  const onlyMine = filter.mineOnly || !permissions.includes("customers.view_all");
  if (onlyMine && !mine.length) return { error: "Bạn chưa được liên kết với Sale/AM nào trên Human (admin liên kết ở Khách hàng → Cài đặt)." };
  const rows: Partner[] = [];
  for (let page = 0; page < 20; page++) {
    let query = db.from("human_partners").select(COLUMNS).eq("workspace_id", scope.workspaceId).eq("active", true);
    if (filter.blocks) query = query.overlaps("block_ids", filter.blocks.map((block) => block.block_id));
    if (filter.company) query = query.ilike("search_text", `%${fold(filter.company).replace(/[%_\\]/gu, "")}%`);
    const { data, error } = await query.order("partner_id").range(page * 1000, page * 1000 + 999);
    if (error) return { error: "Chưa đọc được danh sách khách hàng." };
    rows.push(...((data ?? []) as unknown as Partner[]));
    if ((data ?? []).length < 1000) break;
  }
  const rank = filter.rank ? fold(filter.rank) : null;
  const kept = rows.filter((row) => (!onlyMine || [row.sale_human_id, row.am_human_id, row.am2_human_id].some((id) => id && mine.includes(String(id))))
    && (!rank || [row.project_rank, row.job_rank, row.am_rank, row.am_rank2, ...(row.am_ranks ?? [])].some((value) => value && fold(value).includes(rank))));
  // Sale / AM names: the linked HireX member, else Human's name.
  const profileIds = [...new Set((links ?? []).flatMap((link) => link.profile_id ? [String(link.profile_id)] : []))];
  const { data: profiles } = profileIds.length ? await db.from("profiles").select("id,full_name").in("id", profileIds) : { data: [] };
  const profileName = new Map((profiles ?? []).map((row) => [String(row.id), String(row.full_name ?? "")]));
  const people = new Map((links ?? []).flatMap((link) => { const name = (link.profile_id && profileName.get(String(link.profile_id))) || link.human_name; return name ? [[String(link.human_user_id), String(name)] as const] : []; }));
  return { db, rows: kept, people, scopeLabel: onlyMine ? "khách bạn là Sale/AM" : "tất cả khách" };
}

function period(args: Record<string, unknown>) {
  const ky = str(args.ky) === "TAT_CA" ? null : str(args.ky);
  if (!ky && !str(args.tu_ngay) && !str(args.den_ngay)) return { from: null, to: null, label: null };
  const range = kpiRange(ky as KpiPeriod | null, str(args.tu_ngay), str(args.den_ngay));
  if ("error" in range) return { error: range.error };
  return { from: range.from, to: range.to, label: range.label };
}

export const customerStatTools: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async thong_ke_khach_hang(args, scope) {
    const db = createPrivilegedClient();
    const blocks = await loadBlocks(db, scope.workspaceId);
    const wanted = resolveBlocks(blocks, str(args.khoi));
    if (wanted && !wanted.length) return { loi: `Không có khối "${args.khoi}". Các khối: ${blocks.map(blockLabel).join(", ")}.` };
    const when = period(args);
    if ("error" in when) return { loi: when.error };
    const seen = await visiblePartners(scope, { blocks: wanted, rank: str(args.loc), mineOnly: args.chi_cua_toi === true });
    if ("error" in seen) return { loi: seen.error };
    const blockNames = new Map(blocks.map((block) => [block.block_id, blockLabel(block)]));
    let rows = seen.rows;
    const newOnes = when.from ? rows.map((row) => ({ row, at: enteredAt(row.block_seen, wanted ? wanted.map((block) => block.block_id) : row.block_ids) }))
      .filter((entry) => entry.at && inRange(entry.at, when.from, when.to)).sort((a, b) => String(b.at).localeCompare(String(a.at))) : null;
    if (newOnes) rows = newOnes.map((entry) => entry.row);
    const by = (str(args.nhom_theo) ?? "HANG") as GroupBy;
    const limit = Math.min(Math.max(Number(args.so_luong) || 30, 1), 100);
    return {
      pham_vi: seen.scopeLabel, khoi: wanted ? wanted.map(blockLabel) : "mọi khối", cac_khoi_dang_co: blocks.map(blockLabel),
      ...(when.label ? { moi_vao_khoi_trong: when.label } : {}),
      tong_cong_ty: rows.length, nhom_theo: by, nhom: countBy(rows, by, blockNames, seen.people),
      ...(newOnes ? {
        cong_ty_moi: newOnes.slice(0, limit).map(({ row, at }) => ({
          ten: row.name, vao_khoi_luc: vnDay(Date.parse(String(at))), tao_tren_human: vnDay(Date.parse(String(row.human_created_at))), khoi: row.block_ids.map((id) => blockNames.get(id) ?? id),
          hang: row.job_rank, xep_hang_du_an: row.project_rank, sale: row.sale_human_id ? seen.people.get(row.sale_human_id) ?? row.sale_name : null, am: row.am_human_id ? seen.people.get(row.am_human_id) ?? row.am_name : null,
          cv_da_gui: row.cv_sent, link: `/customers?id=${row.partner_id}`,
        })),
        ghi_chu: "Ngày vào khối: HireX ghi nhận từ 21/10/2026; công ty có từ trước đó lấy ngày tạo trên Human. \"Hạng 0\" không có trong dữ liệu: dự án trọng điểm là Xếp hạng dự án \"[Dự án ưu tiên] X1/X2\".",
      } : { ghi_chu: "\"Hạng\" là cột Hạng (Hạng 1…8); dự án trọng điểm/ưu tiên là Xếp hạng dự án \"[Dự án ưu tiên] X1/X2\" (không có \"Hạng 0\")." }),
      link: "/customers",
    };
  },

  async tong_hop_cv(args, scope) {
    const db = createPrivilegedClient();
    const blocks = await loadBlocks(db, scope.workspaceId);
    const wanted = resolveBlocks(blocks, str(args.khoi));
    if (wanted && !wanted.length) return { loi: `Không có khối "${args.khoi}". Các khối: ${blocks.map(blockLabel).join(", ")}.` };
    const when = period(args);
    if ("error" in when) return { loi: when.error };
    const seen = await visiblePartners(scope, { blocks: wanted, rank: str(args.loc), mineOnly: args.chi_cua_toi === true, company: str(args.cong_ty) });
    if ("error" in seen) return { loi: seen.error };
    const names = new Map(seen.rows.map((row) => [Number(row.partner_id), row.name ?? `Khách ${row.partner_id}`]));
    const ids = [...names.keys()];
    const reports: Array<{ partner_id: number; name: string; data: unknown }> = [];
    let oldest: string | null = null;
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data } = await db.from("human_partner_reports").select("partner_id,data,fetched_at").eq("workspace_id", scope.workspaceId).in("partner_id", ids.slice(offset, offset + 100)).not("data", "is", null);
      for (const row of data ?? []) {
        reports.push({ partner_id: Number(row.partner_id), name: names.get(Number(row.partner_id)) ?? "", data: row.data });
        if (!oldest || String(row.fetched_at) < oldest) oldest = String(row.fetched_at);
      }
    }
    const kind = (str(args.loai) ?? "PHONG_VAN") as CvKind | "TONG_QUAN";
    const kinds: CvKind[] = kind === "TONG_QUAN" ? ["CHO_GUI", "DA_GUI", "PHONG_VAN", "OFFER", "ONBOARD", "FAIL"] : [kind];
    const status = str(args.trang_thai);
    const all = gatherCvs(reports, kinds).filter((cv) => statusMatches(cv.item.status, status) && inRange(cvDay(cv), when.from, when.to));
    const { data: codeRows } = await db.from("human_master_codes").select("master_id,name").eq("workspace_id", scope.workspaceId).lt("master_id", 1000);
    const place = new Map((codeRows ?? []).map((row) => [String(row.master_id), String(row.name)]));
    const base = {
      pham_vi: seen.scopeLabel, khoi: wanted ? wanted.map(blockLabel) : "mọi khối", ...(when.label ? { thoi_gian: when.label } : {}),
      du_lieu: { so_cong_ty_xet: ids.length, co_tinh_trang_cv: reports.length, cap_nhat_cu_nhat: oldest ? vnDayTime(Date.parse(oldest)) : null },
      ghi_chu: "tong_cv đếm theo công ty (một UV gửi nhiều công ty tính nhiều lần); số người là so_ung_vien_khac_nhau. Lấy từ Tình trạng CV đã lưu của từng công ty (Human), cập nhật mỗi 6 giờ hoặc khi mở công ty. Lịch phỏng vấn theo ngày phỏng vấn Human ghi; CV chưa chốt lịch không có ngày.",
    };
    if (kind === "TONG_QUAN") {
      return { ...base, tong_cv: all.length, so_ung_vien_khac_nhau: new Set(all.map((cv) => cv.item.code ?? `ten:${cv.item.name}`)).size, theo_loai: kinds.map((item) => ({ loai: CV_KIND_LABEL[item], so_cv: all.filter((cv) => cv.kind === item).length })),
        theo_cong_ty: countCompanies(all).slice(0, 40) };
    }
    const sorted = kind === "PHONG_VAN"
      ? all.sort((a, b) => (humanTime(a.item.interviewAt) || Infinity) - (humanTime(b.item.interviewAt) || Infinity))
      : all.sort((a, b) => (humanTime(b.item.updatedAt) || 0) - (humanTime(a.item.updatedAt) || 0));
    const limit = Math.min(Math.max(Number(args.so_luong) || 40, 1), 120);
    const statuses = new Map<string, number>();
    for (const cv of all) statuses.set(cv.item.status ?? "(trống)", (statuses.get(cv.item.status ?? "(trống)") ?? 0) + 1);
    const rounds = new Map<string, number>();
    if (kind === "PHONG_VAN") for (const cv of all) { const round = interviewRound(cv.item.status) ?? "Chưa ghi vòng"; rounds.set(round, (rounds.get(round) ?? 0) + 1); }
    return {
      ...base, loai: CV_KIND_LABEL[kind], ...(status ? { loc_trang_thai: status } : {}), tong_cv: all.length,
      // One candidate can be in several companies' lists.
      so_ung_vien_khac_nhau: new Set(all.map((cv) => cv.item.code ?? (cv.item.cvId != null ? `cv:${cv.item.cvId}` : `ten:${cv.item.name}`))).size,
      theo_cong_ty: countCompanies(all).slice(0, 40),
      theo_trang_thai: [...statuses].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([trang_thai, so_cv]) => ({ trang_thai, so_cv })),
      ...(kind === "PHONG_VAN" ? { theo_vong: [...rounds].map(([vong, so_cv]) => ({ vong, so_cv })), co_ngay_phong_van: all.filter((cv) => Number.isFinite(humanTime(cv.item.interviewAt))).length } : {}),
      ...(kind === "CHO_GUI" || args.tom_tat_ky_nang === true ? { ky_nang_pho_bien: topValues(all.map((cv) => cv.item.skill)), vi_tri_pho_bien: topValues(all.map((cv) => cv.item.position), 10) } : {}),
      danh_sach: sorted.slice(0, limit).map((cv) => ({
        cong_ty: cv.company, ung_vien: cv.item.name, ma: cv.item.code, vi_tri: cv.item.position, ky_nang: cv.item.skill,
        dia_diem: cv.item.address ? place.get(cv.item.address) ?? cv.item.address : null, trang_thai: cv.item.status,
        ...(kind === "PHONG_VAN" ? { lich_phong_van: vnDayTime(humanTime(cv.item.interviewAt)) ?? "Chưa có ngày", vong: interviewRound(cv.item.status) } : { cap_nhat: vnDay(humanTime(cv.item.updatedAt)) }),
        link: `/customers?id=${cv.partnerId}`,
      })),
      ...(sorted.length > limit ? { con_nua: sorted.length - limit } : {}),
    };
  },
};

function countCompanies(cvs: Array<{ partnerId: number; company: string }>) {
  const counts = new Map<number, { cong_ty: string; so_cv: number }>();
  for (const cv of cvs) { const entry = counts.get(cv.partnerId) ?? { cong_ty: cv.company, so_cv: 0 }; entry.so_cv += 1; counts.set(cv.partnerId, entry); }
  return [...counts.values()].sort((a, b) => b.so_cv - a.so_cv);
}
