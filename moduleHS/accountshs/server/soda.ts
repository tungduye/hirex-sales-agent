import "server-only";

import { askAccounts } from "./owl";

/* Soda (Trợ lý HireX) · công cụ "tai_nguyen": hỏi số liệu / danh sách tài nguyên AccountsHS bằng câu thường.
   Đi qua đúng bộ hiểu câu của Cú vọ (owl.ts) nên học gì ở Cú vọ thì Soda biết nấy (mẫu đã học, từ đã dạy, bộ CRM riêng).
   CHỈ ĐỌC: câu đổi / xoá / thêm → trả lời hướng dẫn vào mục Tài nguyên, không tạo thay đổi nào. Quyền: "accounts.view" (như mục Tài nguyên). */
type Scope = { context: { permissions: readonly string[] } };
type Row = { tab?: string; label?: string; status?: string | null; owner?: string | null };

export const accountsTools: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async tai_nguyen(args, scope) {
    if (!scope.context.permissions.includes("accounts.view")) return { loi: "Bạn chưa có quyền mục Tài nguyên (Tài khoản · Xem)." };
    const q = String(args.cau_hoi ?? "").trim().slice(0, 400);
    if (!q) return { loi: "Cần câu hỏi." };
    let r: Record<string, unknown>;
    try { r = await askAccounts(q); } catch (e) { return { loi: e instanceof Error ? e.message : String(e) }; }
    const kind = String(r.kind ?? "");
    const chips = ((r.chips as Array<{ t?: string }> | undefined) ?? []).map((c) => c.t).filter(Boolean);
    if (kind === "change") return { loi: "Soda chỉ tra cứu tài nguyên. Muốn đổi / xoá / thêm, hãy dùng Cú vọ trong mục Tài nguyên (có xem trước và duyệt).", da_hieu: chips };
    if (kind === "ask") return { can_hoi_lai: r.msg, lua_chon: ((r.options as Array<{ t?: string }> | undefined) ?? []).map((o) => o.t).slice(0, 6) };
    if (kind === "error") return { loi: r.msg };
    const rows = ((r.rows as Row[] | undefined) ?? []).slice(0, 10).map((x) => ({ nen_tang: x.tab, tai_khoan: x.label, trang_thai: x.status ?? null, owner: x.owner ?? null }));
    const groups = ((r.groups as Array<{ t: string; n: number }> | undefined) ?? []).slice(0, 30).map((g) => ({ nhom: g.t, so: g.n }));
    const stats = ((r.stats as Array<{ t: string; n: number }> | undefined) ?? []).slice(0, 12).map((s) => ({ ten: s.t, so: s.n }));
    return {
      tra_loi: r.msg, so_luong: r.count ?? null, dieu_kien_da_hieu: chips,
      ...(groups.length ? { theo_nhom: groups } : {}), ...(stats.length ? { thong_ke: stats } : {}), ...(rows.length ? { vi_du: rows } : {}),
      ghi_chu: "Đọc lại 'dieu_kien_da_hieu' để nói rõ đã lọc theo gì. Nhãn 'CRM · …' là dữ liệu CRM cũ, KHÁC Tình trạng sở hữu của AccountsHS — nói rõ khi trả lời.",
    };
  },
};
