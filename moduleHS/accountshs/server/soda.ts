import "server-only";

import { askAccounts } from "./owl";

/* Soda (Trợ lý HireX) · Tài nguyên qua bộ hiểu câu của Cú vọ (owl.ts) — học gì ở Cú vọ thì Soda biết nấy (mẫu đã học, từ đã dạy, bộ CRM riêng).
   - Công cụ "tai_nguyen": Soda (model) gọi khi cần, kết quả kèm __card (thẻ kết quả kiểu Cú vọ cho giao diện web, không gửi model).
   - sodaFast(): câu hỏi rõ ràng là tra tài nguyên → trả lời THẲNG bằng Cú vọ, không qua model của Soda (nhanh hơn ~3–10 lần, 0 token Soda);
     câu mơ hồ / nối tiếp / muốn đổi dữ liệu → trả null để Soda xử lý như thường.
   CHỈ ĐỌC: câu đổi / xoá / thêm → hướng dẫn vào mục Tài nguyên. Quyền: "accounts.view" (như mục Tài nguyên). */
type Scope = { context: { permissions: readonly string[] } };
type O = Record<string, unknown>;
type Row = { tab?: string; label?: string; status?: string | null; owner?: string | null; color?: string | null; lk?: string };
type Named = { t: string; n: number; c?: string | null };

/** Thẻ kết quả gửi giao diện (moduleHS/accountshs/soda-card.tsx) — nhỏ gọn, đủ để vẽ như Cú vọ và mở lại đúng câu trong Tài nguyên. */
/** spec = điều kiện lọc đã hiểu (mở bảng Tài nguyên lọc đúng như Cú vọ, không hỏi lại); next = gợi ý lọc tiếp; fast = trả lời thẳng (giao diện chỉ hiện thẻ). */
export type CuvoCard = { v: 1; q: string; kind: string; msg: string; count: number | null; chips: string[]; stats: Named[]; groups: Array<Named & { spec?: O }>; rows: Row[]; spec?: O | null; next?: string[]; auto?: boolean; fast?: boolean };

/** "facebook sống của REC, của SALE hoặc của Hải" → ["facebook sống của REC", "… của SALE", "… của Hải"]; không phải câu liệt kê → null. */
export function splitGroups(q: string): string[] | null {
  const parts = q.split(/\s*(?:,|;|\bhoặc\b|\bhay\b|\bvà\b|\bvới\b)?\s*\b(?=của\s)/iu);
  if (parts.length < 3) return null;
  const base = parts[0].trim(), gs = parts.slice(1).map((x) => x.replace(/^của\s+/iu, "").replace(/[\s,;]+(?:hoặc|hay|và|với)?\s*$/iu, "").replace(/[?.!\s]+$/u, "").trim()).filter(Boolean);
  return base && gs.length >= 2 && gs.length <= 6 ? gs.map((g) => `${base} của ${g}`) : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const NOUN = /(^|[^a-z])(facebook|fb|face|nick|acc|account|tai khoan|email|e-mail|mail|gmail|sdt|so dien thoai|sim|whatsapp|linkedin|telegram|proxy|fanpage|page|bai dang|nhom fb|group fb|via|clone|(?:nick|acc|tai khoan|tk)\s+zalo|zalo\s+(?:song|die|chet|khang))([^a-z]|$)/;
const SELF = /(^|[^a-z])(cu vo|tai nguyen|accountshs)([^a-z]|$)/;
const ASK = /(bao nhieu|\bnew\b|\bl1\b|\bcrm\b|\bkxd\b|\bws\b|dem|so luong|liet ke|danh sach|cho (?:toi|em|anh|chi|minh) xem|xem|mo |hien|tim|loc|nhung|nao|co may|thong ke|theo owner|theo bo phan|cua |song|die|chet|khang|live|xac minh|mat khau|tinh trang|so huu|lau dai|tam thoi|\?)/;
const NOT = /(ket noi|kenh|chien dich|hoi thoai|inbox|tin nhan|gui |ghim|nhom zalo|ung vien|khach hang|cong ty|\bjob\b|lich hen|\bkpi\b|\bcv\b|bao gia|soan|dang bai|viet bai|content|noi dung|la gi|nghia la|tai sao|lam sao|cach (?:lam|dung|tao)|huong dan)/;
const SHOW = /(liet ke|danh sach|cho (?:toi|em|anh|chi|minh) xem|^xem |\bxem\b.*\b(?:tai khoan|nick|acc|danh sach)|mo (?:ra|trong|danh sach|bang)|hien (?:ra|thi))/;
const FOLLOW = /^(con|the con|vay con|vay|the|thi|nhung|trong do|trong so|so do|cai do|o tren|vua roi|them|bot)\b|thi sao|the nao|nhu tren|\bkia\b|\bdo\s*\??$/;
/** Câu hỏi tự đủ nghĩa về tài nguyên (không phải câu nối tiếp, không phải việc của mục khác). followUp = đang giữa cuộc trò chuyện. */
export function isResourceQ(q: string, followUp = false): boolean {
  const x = fold(q).replace(/\s+/g, " ").trim();
  if (x.length < 6 || x.length > 300 || NOT.test(x)) return false;
  if (followUp && (FOLLOW.test(x) || x.split(" ").length < 4)) return false;   // "còn email?", "thế của SALE?" → để Soda hiểu theo ngữ cảnh
  return (NOUN.test(x) || SELF.test(x)) && (ASK.test(x) || SELF.test(x));
}

const chipsOf = (r: O) => ((r.chips as Array<{ t?: string }> | undefined) ?? []).map((c) => String(c.t ?? "")).filter(Boolean);
function cardOf(q: string, r: O): CuvoCard {
  const rows = ((r.rows as Row[] | undefined) ?? []).slice(0, 6).map((x) => ({ tab: x.tab, label: String(x.label ?? "").slice(0, 120), status: x.status ?? null, owner: x.owner ?? null, color: x.color ?? null, ...(x.lk ? { lk: String(x.lk).slice(0, 120) } : {}) }));
  const groups = ((r.groups as Named[] | undefined) ?? []).slice(0, 12).map((g) => ({ t: String(g.t), n: +g.n || 0, c: g.c ?? null }));
  const stats = ((r.stats as Named[] | undefined) ?? []).slice(0, 6).map((s) => ({ t: String(s.t), n: +s.n || 0, c: s.c ?? null }));
  const next = ((r.next as string[] | undefined) ?? []).map(String).slice(0, 4);
  return { v: 1, q: q.slice(0, 300), kind: String(r.kind ?? ""), msg: String(r.msg ?? "").slice(0, 400), count: typeof r.count === "number" ? r.count : null, chips: chipsOf(r).slice(0, 10), stats, groups, rows, spec: (r.spec as O | undefined) ?? null, ...(next.length ? { next } : {}) };
}
type Multi = Array<{ cau: string; so_luong?: number | null; tra_loi?: unknown; dieu_kien_da_hieu?: string[]; loi?: string; spec?: O }>;
async function askMany(split: string[]): Promise<Multi> {
  return Promise.all(split.map(async (x) => { try { const y = await askAccounts(x, true); return { cau: x, so_luong: (y.count as number | undefined) ?? null, tra_loi: y.msg, dieu_kien_da_hieu: chipsOf(y), spec: y.spec as O | undefined }; } catch (e) { return { cau: x, loi: e instanceof Error ? e.message : String(e) }; } }));
}
const multiCard = (q: string, each: Multi): CuvoCard => ({ v: 1, q: q.slice(0, 300), kind: "multi", msg: "Theo từng nhóm", count: null, chips: [], stats: [], rows: [], groups: each.map((g) => ({ t: g.cau.replace(/^.*\bcủa\s+/iu, ""), n: g.so_luong ?? 0, c: null, ...(g.spec ? { spec: g.spec } : {}) })) });

export const accountsTools: Record<string, (args: Record<string, unknown>, scope: Scope) => Promise<unknown>> = {
  async tai_nguyen(args, scope) {
    if (!scope.context.permissions.includes("accounts.view")) return { loi: "Bạn chưa có quyền mục Tài nguyên (Tài khoản · Xem)." };
    const q = String(args.cau_hoi ?? "").trim().slice(0, 400);
    if (!q) return { loi: "Cần câu hỏi." };
    const split = splitGroups(q);
    if (split) {   // câu liệt kê nhiều nhóm: trả số của từng nhóm (Soda trả lời từng dòng)
      const each = await askMany(split);
      return { theo_tung_nhom: each.map((g) => ({ cau: g.cau, so_luong: g.so_luong, tra_loi: g.tra_loi, dieu_kien_da_hieu: g.dieu_kien_da_hieu, ...(g.loi ? { loi: g.loi } : {}) })), ghi_chu: "Trả lời TỪNG nhóm một dòng (số + điều kiện đã hiểu). Một tài khoản có thể thuộc nhiều nhóm (vd Hải thuộc REC) nên không cộng dồn. Giao diện web tự hiện thẻ kết quả. Không nhắc tên \"Cú vọ\".", __card: multiCard(q, each) };
    }
    let r: O;
    try { r = await askAccounts(q, true); } catch (e) { return { loi: e instanceof Error ? e.message : String(e) }; }
    const kind = String(r.kind ?? ""), chips = chipsOf(r);
    if (kind === "change") return { loi: "Soda chỉ tra cứu tài nguyên. Muốn đổi / xoá / thêm, hãy dùng Cú vọ trong mục Tài nguyên (có xem trước và duyệt).", da_hieu: chips };
    if (kind === "ask") return { can_hoi_lai: r.msg, lua_chon: ((r.options as Array<{ t?: string }> | undefined) ?? []).map((o) => o.t).slice(0, 6) };
    if (kind === "error") return { loi: r.msg };
    const c = cardOf(q, r);
    return {
      tra_loi: r.msg, so_luong: r.count ?? null, dieu_kien_da_hieu: chips,
      ...(c.groups.length ? { theo_nhom: c.groups.map((g) => ({ nhom: g.t, so: g.n })) } : {}), ...(c.stats.length ? { thong_ke: c.stats.map((s) => ({ ten: s.t, so: s.n })) } : {}),
      ...(c.rows.length ? { vi_du: c.rows.map((x) => ({ nen_tang: x.tab, tai_khoan: x.label, trang_thai: x.status, owner: x.owner })) } : {}),
      ghi_chu: "Đọc lại 'dieu_kien_da_hieu' để nói rõ đã lọc theo gì. Nhãn 'CRM · …' là dữ liệu CRM cũ, KHÁC Tình trạng sở hữu của AccountsHS — nói rõ khi trả lời. Giao diện web tự hiện thẻ kết quả (danh sách + nút xem trên bảng Tài nguyên) nên chỉ trả lời 1 câu ngắn, không liệt kê lại ví dụ. Không nhắc tên \"Cú vọ\" (đó chỉ là bộ tra cứu bên dưới).",
      __card: c,
    };
  },
};

const nf = (n: number) => n.toLocaleString("vi-VN");
/** Trả lời thẳng câu hỏi tài nguyên bằng Cú vọ (không gọi model của Soda). null = để Soda tự xử lý. */
export async function sodaFast(question: string, permissions: readonly string[], followUp = false): Promise<{ answer: string; card: CuvoCard } | null> {
  if (!permissions.includes("accounts.view") || !isResourceQ(question, followUp)) return null;
  const q = question.trim().slice(0, 400), auto = SHOW.test(fold(q));
  const split = splitGroups(q);
  if (split) {
    const each = await askMany(split); if (each.some((g) => g.loi || g.so_luong === null)) return null;
    const card = { ...multiCard(q, each), auto, fast: true };
    return { answer: `Dạ:\n${each.map((g) => `- **${g.cau.replace(/^.*\bcủa\s+/iu, "")}**: ${nf(g.so_luong ?? 0)}${g.dieu_kien_da_hieu?.length ? ` (${g.dieu_kien_da_hieu.join(" · ")})` : ""}`).join("\n")}\n\nMột tài khoản có thể thuộc nhiều nhóm nên không cộng dồn.`, card };
  }
  let r: O; try { r = await askAccounts(q, true); } catch { return null; }
  const kind = String(r.kind ?? "");
  if (!["search", "count", "group", "say"].includes(kind)) return null;
  const card = { ...cardOf(q, r), auto: auto && kind !== "say" && !!r.count, fast: true };
  if (kind === "say") return { answer: String(r.msg ?? ""), card };
  const chips = card.chips, msg = String(r.msg ?? "").trim();
  let answer = `Dạ, **${msg}**${/[.!?]$/.test(msg) ? "" : "."}${chips.length ? `\nĐiều kiện em hiểu: ${chips.join(" · ")}.` : ""}`;
  if (kind === "group" && card.groups.length) answer += "\n" + card.groups.slice(0, 10).map((g) => `- ${g.t}: ${nf(g.n)}`).join("\n") + (card.groups.length > 10 ? `\n- … và ${card.groups.length - 10} nhóm khác` : "");
  if (!r.count && kind !== "group") answer += "\nSếp thử bỏ bớt điều kiện hoặc mở Tài nguyên để lọc tay nhé.";
  return { answer, card };
}

/** Gắn thẻ vào câu trả lời (chỉ web): <!--cuvo:base64url(JSON)-->; giao diện tách ra vẽ thẻ, lịch sử gửi lại model thì bỏ đi. */
export const cardMarker = (c: CuvoCard) => `\n<!--cuvo:${Buffer.from(JSON.stringify(c), "utf8").toString("base64url")}-->`;
/** Lấy thẻ khỏi kết quả công cụ (không để model thấy). */
export function takeCard(out: unknown): CuvoCard | null {
  if (!out || typeof out !== "object" || !("__card" in out)) return null;
  const c = (out as { __card?: CuvoCard }).__card ?? null; delete (out as { __card?: unknown }).__card; return c;
}
