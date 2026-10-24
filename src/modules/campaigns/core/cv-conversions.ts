// CV chuyển hóa (migration 145) for Soda and Tổng quan: pure helpers, no I/O; covered by tests/cv-conversions.test.mjs.

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/đ/giu, "d").toLowerCase();

/** "MKT Zalo", "chiến dịch Zalo", "marketing" name no campaign in particular: every campaign (no filter). */
export function isGenericCampaignWord(value: string | null | undefined) {
  if (!value?.trim()) return true;
  return fold(value).replace(/\b(mkt|marketing|chien dich|campaign|zalo|facebook|fb|ca nhan|tin|cac|tat ca|moi)\b/gu, "").replace(/[^a-z0-9]+/gu, "") === "";
}

export interface ConversionRow { conversation: string; nick: string; nickName: string; owner: string | null; department: string | null; file: string; at: number; campaign: string | null; source: "FILE" | "REC_FLOW" }
export type ConversionBy = "TONG" | "NGUOI" | "BO_PHAN" | "NICK" | "CHIEN_DICH" | "NGAY" | "NGUON";

const vnDay = (at: number) => new Date(at + 7 * 3_600_000).toISOString().slice(0, 10);

/** Rows grouped for the answer table: group, CVs, of which from MKT Zalo; biggest first (by day: newest first). */
export function conversionTable(rows: ConversionRow[], by: ConversionBy) {
  if (by === "TONG") return [{ nhom: "Tổng", so_cv: rows.length, tu_mkt_zalo: rows.filter((row) => row.campaign).length }];
  const key = (row: ConversionRow) => by === "NGUOI" ? row.owner ?? "Nick chưa có người dùng chính" : by === "BO_PHAN" ? row.department ?? "Chưa xếp bộ phận"
    : by === "NICK" ? row.nickName : by === "CHIEN_DICH" ? row.campaign ?? "Không qua chiến dịch (chat khác)" : by === "NGAY" ? vnDay(row.at) : row.campaign ? "MKT Zalo" : "Chat khác";
  const groups = new Map<string, { nhom: string; so_cv: number; tu_mkt_zalo: number }>();
  for (const row of rows) {
    const name = key(row);
    const group = groups.get(name) ?? { nhom: name, so_cv: 0, tu_mkt_zalo: 0 };
    group.so_cv += 1; if (row.campaign) group.tu_mkt_zalo += 1;
    groups.set(name, group);
  }
  const list = [...groups.values()];
  return by === "NGAY" ? list.sort((a, b) => b.nhom.localeCompare(a.nhom)) : list.sort((a, b) => b.so_cv - a.so_cv || a.nhom.localeCompare(b.nhom, "vi"));
}
