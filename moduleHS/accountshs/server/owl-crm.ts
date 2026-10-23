// Cú vọ · BỘ CRM RIÊNG (tạm thời, gỡ được) — giúp người mới chuyển từ CRM cũ sang hỏi đúng ý.
//   Dữ liệu: các cột "CRM · …" (select) đã tách từ Ghi chú lúc kéo CRM: Xếp hạng AM · Xếp hạng · Combo UV · Kiểm tra · Nguồn chuyển.
//   Cú vọ hiểu chúng như mọi cột khác (luật chung); file này chỉ thêm: (1) câu giải thích khi kết quả dùng cột CRM, kèm số theo
//   AccountsHS để không nhầm "Đã xác minh (CRM)" với "Lâu dài"; (2) trả lời câu "… là gì / khác gì"; (3) bảng thuật ngữ cho AI.
//   GỠ HOÀN TOÀN: xoá các cột "CRM · …" trong Cài đặt (hoặc ahs_fields label like 'CRM ·%') — mọi hàm ở đây tự tắt khi không còn cột,
//   rồi xoá file này + 3 chỗ gọi CRM.* trong owl.ts.
import { fold, str, type Id, type QField, type Spec } from "./owl-query.ts";

export const PREFIX = "CRM ·";
export const isCrm = (f: QField | undefined) => !!f && f.label.trim().startsWith(PREFIX);
export const on = (fields: QField[]) => fields.some(isCrm);

/** nghĩa từng cột / nhãn CRM (viết cho người dùng đọc) */
const GLOSS: Array<{ k: string[]; t: string }> = [
  { k: ["xac minh", "xep hang am", "am", "da xac minh", "chua xac minh"], t: "CRM · Xếp hạng AM: kết quả AM kiểm tra trên CRM cũ — \"Đã xác minh\" (CRM khi đó coi là sở hữu lâu dài) / \"Chưa xác minh\" (CRM coi là tạm thời). Facebook, Zalo, LinkedIn, Telegram, WhatsApp lấy theo email / SĐT cùng cụm CRM. Ở AccountsHS, Lâu dài được TÍNH LẠI: còn sống + có mật khẩu + có email / SĐT xác minh Lâu dài còn sống — nên \"Đã xác minh (CRM)\" KHÔNG đồng nghĩa \"Lâu dài\"." },
  { k: ["xep hang", "new", "new 1", "l1", "none", "kxd", "ws", "rec"], t: "CRM · Xếp hạng: nhãn xếp hạng tài khoản của Rec trên CRM, giữ nguyên chữ CRM (New, New 1, L1, None, KXD, WS…). Lúc chuyển dữ liệu, SĐT \"New\" được đặt Live, \"New 1\" đặt Đang kháng; các nhãn khác chỉ để tra cứu." },
  { k: ["combo", "combo uv", "tai khoan nhan vien", "quan ly marketing"], t: "CRM · Combo UV: nhóm Combo của R&D trên CRM — Tài khoản nhân viên / Tài khoản quản lý-marketing." },
  { k: ["kiem tra", "song", "khong song", "co song", "da chet", "khoa", "chan"], t: "CRM · Kiểm tra (SĐT): lần gọi kiểm tra SIM gần nhất ghi trong CRM — Có sóng / Không sóng / Bị khóa-chặn / Đã chết. Khác Trạng thái (Live/Die) hiện tại." },
  { k: ["nguon chuyen", "cloud", "ceo chuyen", "bich chuyen", "hoan chuyen"], t: "CRM · Nguồn chuyển: ai bàn giao tài khoản theo CRM (Cloud CEO chuyển, Bích chuyển, Hoàn chuyển…)." },
];
export function glossary(fields: QField[]): string {
  if (!on(fields)) return "";
  return "\nBỘ CRM CŨ (cột \"CRM · …\" — chỉ dùng khi người dùng nói theo CRM: đã xác minh / chưa xác minh / New / New 1 / L1 / Cloud-CEO chuyển…; KHÔNG dùng cho \"lâu dài / tạm thời\" — đó là trường Tình trạng sở hữu):\n" + GLOSS.map((g) => "- " + g.t).join("\n");
}

/** câu hỏi nghĩa: "đã xác minh là gì", "new 1 nghĩa là sao", "xác minh crm khác lâu dài thế nào" → câu trả lời, hoặc null */
export function explain(text: string, fields: QField[]): string | null {
  if (!on(fields)) return null;
  const t = ` ${fold(text).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  if (!/ (la gi|nghia la|nghia gi|y nghia|khac gi|khac nhau|giai thich|hieu the nao|la sao) /.test(t)) return null;
  const hits = GLOSS.filter((g) => g.k.some((k) => t.includes(` ${k} `)));
  if (!hits.length) return null;
  const own = / (lau dai|tam thoi|so huu) /.test(t) ? "\nTình trạng sở hữu (AccountsHS): Mất = đã Die · Không xác định = chưa có mật khẩu · Lâu dài = còn Live và có ≥ 1 email / SĐT xác minh Lâu dài còn sống · còn lại Tạm thời." : "";
  return hits.map((g) => g.t).join("\n") + own;
}

/** kết quả dùng cột CRM → 1 câu nhắc + số theo AccountsHS cùng phạm vi (Tình trạng sở hữu = Lâu dài) */
export function note(sp: Spec, fields: QField[], count: (s: Spec) => number): string {
  const F = new Map<Id, QField>(fields.map((f) => [f.id, f] as const));
  const used: QField[] = [];
  const walk = (w: unknown) => { if (!w || typeof w !== "object") return; const o = w as Record<string, unknown>;
    for (const g of ["or", "and"]) if (Array.isArray(o[g])) (o[g] as unknown[]).forEach(walk);
    if (o.not) walk(o.not);
    const f = typeof o.field === "number" ? F.get(o.field) : fields.find((x) => fold(x.label) === fold(o.field)); if (isCrm(f)) used.push(f!); };
  (sp.where ?? []).forEach(walk);
  if (!used.length) return "";
  let s = " · theo nhãn CRM cũ (" + [...new Set(used.map((f) => f.label.replace(PREFIX, "").trim()))].join(", ") + "), không phải Tình trạng sở hữu";
  if (used.some((f) => fold(f.label).includes("xep hang am")) && typeof sp.tab === "number") {
    const own = fields.find((f) => f.tab_id === sp.tab && fold(f.label) === "tinh trang so huu");
    if (own) {
      const isAm = (w: unknown) => { const o = w as Record<string, unknown>; const f = typeof o?.field === "number" ? F.get(o.field) : undefined; return !!f && isCrm(f) && fold(f.label).includes("xep hang am"); };
      const s2: Spec = { ...sp, where: [...(sp.where ?? []).filter((w) => !isAm(w)), { field: own.id, op: "in", value: ["Lâu dài"] }] };
      try { s += `; theo AccountsHS cùng phạm vi có ${count(s2)} Lâu dài`; } catch { /* bỏ qua */ }
    }
  }
  return s;
}
export const label = (f: QField) => str(f.label);
