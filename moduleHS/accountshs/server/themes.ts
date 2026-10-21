import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/* Giao diện (theme) — port của style/themes.py. CSS gốc nằm ở moduleHS/accountshs/ui/themes/*.css (đọc lúc chạy, sửa file là thấy),
   ảnh xem trước ở ui/themes/preview/<id>.jpg (phục vụ qua /api/hs/accountshs/theme-preview/<id>.jpg). Trong CSS viết @T thay cho html[data-theme="<id>"]
   (trang Tài nguyên chạy trong khung riêng nên theme chỉ áp cho khung đó, không đụng giao diện HireX). */

export interface ThemeInfo { id: string; name: string; en: string; group: string; layout: "top" | "side"; scheme: "light" | "dark"; frame: "" | "inset" | "center"; img: string }
const THEMES: Array<[string, string, string, string, ThemeInfo["layout"], ThemeInfo["scheme"], ThemeInfo["frame"]]> = [
  ["base", "Chuẩn Mực", "Giao diện gốc", "Gốc", "top", "light", ""],
  ["glass", "Thủy Tinh", "Apple Liquid Glass · iPadOS", "Apple", "top", "light", ""],
  ["cupertino", "Cupertino", "macOS · ứng dụng gốc", "Apple", "side", "light", ""],
  ["fluent", "Redmond", "Microsoft Fluent 2", "Microsoft · Google", "side", "light", "inset"],
  ["material", "Mountain View", "Google Material 3", "Microsoft · Google", "side", "light", "inset"],
  ["atlas", "Sydney", "Atlassian · Jira", "Công cụ kỹ thuật", "side", "light", ""],
  ["primer", "Octo", "GitHub Primer", "Công cụ kỹ thuật", "top", "light", "center"],
  ["pajamas", "Tử Đằng", "GitLab Pajamas", "Công cụ kỹ thuật", "side", "light", ""],
  ["linear", "Tuyến Tính", "Linear", "Công cụ kỹ thuật", "side", "light", "inset"],
  ["geist", "Đơn Sắc", "Vercel Geist", "Công cụ kỹ thuật", "top", "light", "center"],
  ["stripe", "Tím Khói", "Stripe Dashboard", "SaaS · Doanh nghiệp", "side", "light", ""],
  ["polaris", "Thương Thuyền", "Shopify Polaris", "SaaS · Doanh nghiệp", "side", "light", "inset"],
  ["lightning", "Tia Chớp", "Salesforce Lightning", "SaaS · Doanh nghiệp", "top", "light", ""],
  ["fiori", "Chân Trời", "SAP Fiori Horizon", "SaaS · Doanh nghiệp", "top", "light", ""],
  ["antd", "Thanh Thiên", "Ant Design", "SaaS · Doanh nghiệp", "side", "light", ""],
  ["carbon", "Cacbon", "IBM Carbon", "SaaS · Doanh nghiệp", "side", "light", ""],
  ["odoo", "Hương Cà", "Odoo ERP", "SaaS · Doanh nghiệp", "top", "light", ""],
  ["airtable", "Lưới Màu", "Airtable", "SaaS · Doanh nghiệp", "top", "light", ""],
  ["notion", "Trang Sổ", "Notion", "SaaS · Doanh nghiệp", "side", "light", "center"],
  ["linear-dark", "Tuyến Tính Đêm", "Linear · tối", "Nền tối", "side", "dark", "inset"],
  ["grafana", "Đài Quan Sát", "Grafana · tối", "Nền tối", "side", "dark", ""],
];
// tính lúc gọi (không lúc nạp module) — cwd là gốc dự án khi chạy
const dir = (...p: string[]) => path.join(process.cwd(), "moduleHS", "accountshs", "ui", "themes", ...p);
const read = (fn: string) => readFile(dir(fn), "utf8").catch(() => "");
const exists = (p: string) => stat(p).then(() => true, () => false);

export async function themesList(): Promise<ThemeInfo[]> {
  const out: ThemeInfo[] = [];
  for (const [id, name, en, group, layout, scheme, frame] of THEMES) {
    if (id !== "base" && !(await exists(dir(id + ".css")))) continue;
    const img = await stat(dir("preview", id + ".jpg")).catch(() => null);
    out.push({ id, name, en, group, layout, scheme, frame, img: img ? `/api/hs/accountshs/theme-preview/${id}.jpg?v=${Math.floor(img.mtimeMs / 1000)}` : "" });
  }
  return out;
}

/** CSS ghép của 1 theme (null = không có theme đó). Bộ chọn @T → html[data-theme="id"] (như themes.py). */
export async function themeCss(tid: string): Promise<string | null> {
  const t = THEMES.find((x) => x[0] === tid);
  if (!t) return null;
  if (tid === "base") return "";
  const body = await read(tid + ".css");
  if (!body) return null;
  const parts = [await read("_shared.css")];
  if (t[4] === "side") parts.push(await read("_side.css"));
  if (t[5] === "dark") parts.push(await read("_dark.css"));
  if (t[6]) parts.push(await read(`_${t[6]}.css`));
  parts.push(body);
  if (t[4] === "side") parts.push(await read("_side_m.css"));
  parts.push(await read("_mobile.css"));
  return parts.join("\n").replaceAll("@T", `html[data-theme="${tid}"]`);
}

/** ảnh xem trước theme (jpg) — null nếu không có */
export async function themePreview(id: string): Promise<Buffer | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  return readFile(dir("preview", id + ".jpg")).catch(() => null);
}
