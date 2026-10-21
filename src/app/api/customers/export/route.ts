import { customerFilters, exportCustomers } from "@/modules/customers/server/customer-data";

const HEADERS: Array<[string, string]> = [["partner_id", "Mã"], ["name", "Công ty"], ["location", "Địa điểm"], ["website", "Website"], ["project_rank", "Xếp hạng dự án"], ["job_rank", "Hạng"],
  ["am_rank", "Xếp hạng AM"], ["am_rank2", "Xếp hạng AM 2"], ["sale_name", "Sale"], ["am_name", "AM"], ["cv_total", "Tổng CV"], ["cv_sent", "CV đã gửi"], ["cv_processing", "CV đang xử lý"],
  ["cv_offer", "Offer"], ["cv_done", "CV xong"], ["contact_name", "Người liên hệ"], ["email", "Email"], ["phone", "Điện thoại"], ["last_note_at", "Ngày ghi chú"], ["last_note", "Ghi chú mới nhất"],
  ["human_created_at", "Ngày tạo"], ["human_created_by", "Người tạo"]];
const cell = (value: unknown) => { const text = value == null ? "" : String(value); return /[",\n\r]/u.test(text) || /^[=+\-@]/u.test(text) ? `"${text.replace(/^([=+\-@])/u, "'$1").replace(/"/gu, '""')}"` : text; };

/** Khách hàng as CSV (what the member may see, with the current filters; at most 10,000 rows). */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const rows = await exportCustomers(customerFilters(params));
  if (!rows) return new Response("Không có quyền hoặc chưa tải được dữ liệu.", { status: 403 });
  const lines = [HEADERS.map(([, label]) => label).join(","), ...rows.map((row) => HEADERS.map(([key]) => cell((row as unknown as Record<string, unknown>)[key])).join(","))];
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="khach-hang-${stamp}.csv"`, "Cache-Control": "private, no-store" } });
}
