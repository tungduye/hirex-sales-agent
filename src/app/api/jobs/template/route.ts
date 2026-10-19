import ExcelJS from "exceljs";
import { hasPermission } from "@/modules/access/server/access-control";
import { getAccountContext } from "@/modules/identity/server/get-account-context";
import { EXCEL_COLUMNS } from "@/modules/jobs/core/job-fields";

export const runtime = "nodejs";

// Excel template for importing jobs: the same headers the import reads, a hint row and one example.
export async function GET() {
  const account = await getAccountContext();
  if (!account?.workspaceId || !await hasPermission("jobs.manage")) return new Response("Forbidden", { status: 403 });
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Job", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = EXCEL_COLUMNS.map((column) => ({ header: column.header, key: column.field, width: column.width }));
  sheet.addRow({ code: "", title: "BrSE", careerTrack: "BrSE", companyName: "Công ty ABC", companyNamePublic: "Có", location: "Hà Nội (Mễ Trì)",
    workMode: "Onsite", japaneseLevelMin: "N2", experienceMin: "3 năm", salaryRange: "30–45 triệu gross", sellingPoints: "Thưởng 2 tháng, onsite Nhật",
    summary: "Trao đổi yêu cầu với khách Nhật, điều phối team phát triển.", requirements: "N2 trở lên; 2 năm làm BrSE", jdLink: "https://example.com/jd",
    interviewProcess: "2 vòng, khoảng 2 tuần", status: "Đang tuyển", priority: "Thường", note: "" });
  sheet.getRow(1).eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } }; cell.alignment = { vertical: "middle", wrapText: true }; });
  EXCEL_COLUMNS.forEach((column, index) => { if (column.hint) sheet.getCell(1, index + 1).note = column.hint; });
  const guide = book.addWorksheet("Hướng dẫn");
  guide.columns = [{ width: 110 }];
  for (const line of [
    "Bắt buộc: Vị trí, Hướng nghề, Công ty, Địa điểm.",
    "Mã job: để trống để HireX tự tạo. Dòng có Mã job đã tồn tại sẽ cập nhật job đó.",
    "Được nói tên công ty: Có / Không. Không thì AI chỉ mô tả công ty, không nêu tên.",
    "Trạng thái: Đang tuyển / Tạm dừng / Đã đóng. AI chỉ dùng job Đang tuyển.",
    "Ưu tiên: Cao / Thường. Job ưu tiên cao được giới thiệu trước.",
    "Tối đa 500 dòng mỗi lần nhập. Xoá dòng ví dụ trước khi nhập.",
  ]) guide.addRow([line]);
  const body = Buffer.from(await book.xlsx.writeBuffer());
  return new Response(body, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": "attachment; filename=\"HireX_Bang_Job_mau.xlsx\"", "Cache-Control": "no-store" } });
}
