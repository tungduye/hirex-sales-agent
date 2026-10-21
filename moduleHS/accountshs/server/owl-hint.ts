// Cú vọ — "hiểu ý" THUẦN (port AI_engine.Hint + hint + merge_hint): tách phần nội dung / số / thời gian / xếp hạng / nhóm / tổng / owner / giá trị
// có thật ra khỏi câu trước khi luật cũ (owl-rules.understand) đọc phần còn lại; rồi gộp lại. File phụ của owl-rules.ts (không I/O, không "server-only").
import { fold, str, leaves, isVirt, type Id, type QField, type Ref, type Where } from "./owl-query.ts";
import { Brain, tok, clone, sim, tabVote, money, contentField, tabOf, words, iter, search, ms, me, gp, isUpper, maxBy, resc, tru, blank, jc, STOPW, NOISE, FILL, GBY, GBYV, VERBS, type O, type Plan, type Ctx } from "./owl-rules.ts";

/** bỏ dấu từng ký tự, giữ vị trí → [chuỗi không dấu, vị trí gốc của từng ký tự] */
export function fmap(text: string): [string, number[]] {
  let out = ""; const idx: number[] = [];
  for (let i = 0; i < text.length; i++) { const ch = text[i]; const f = /\s/.test(ch) ? " " : fold(ch); for (const x of f) { out += x; idx.push(i); } }
  return [out, idx];
}
const SYN: Record<string, string> = { like: "thich", likes: "thich", tim: "thich", react: "cam xuc", reaction: "cam xuc", cmt: "binh luan", comment: "binh luan", comments: "binh luan", share: "chia se", shares: "chia se", view: "xem", views: "xem", "luot xem": "xem", follow: "theo doi", follower: "theo doi", followers: "theo doi", sub: "theo doi", gia: "gia", tien: "tien" };
const CT = String.raw`(?:noi ve|viet ve|nhac (?:den|toi)|nhac|lien quan (?:den|toi)|lien quan|co chu|co tu khoa|co tu|co cum tu|co cum|chua chu|chua tu|chua cum|chua|tu khoa|keyword|ve chu de|ve)`;
const STOPS = String.raw`(?:duoc |da )?(?:dang|tao|sua|cap nhat|them)\s+(?:trong|tu|thang|ngay|tuan|nam|hom|truoc|sau|gan|luc|vao)|cua|thuoc|tinh trang|trang thai|status|owner|trong (?:\d+ )?(?:ngay|tuan|thang|nam)|tu ngay|den ngay|ngay \d|thang \d|nam \d|hom nay|hom qua|tuan (?:nay|truoc)|` +
  String.raw`thang (?:nay|truoc)|nam (?:nay|ngoai|truoc)|xep|sap xep|theo|top \d|(?:nhieu|it|cao|thap|lon|nho)(?: [a-z]+){0,3} nhat|moi nhat|cu nhat|gan day|bao nhieu|khong\b|ko\b|nhe\b|nao\b|dang (?:o|tai)|` +
  String.raw`(?:va|hoac) (?:co|chua|khong|dang|tinh trang)|tu \d|truoc \d|sau \d|tren \d|duoi \d|nhieu hon|it hon|lon hon|>|<|=`;

export type HintAdd = O & { where?: Where[] | null; sort?: O; group?: O; agg?: O; limit?: number; owner?: Id[]; q?: string; _tab?: Id | null; _tabf?: Id; _money?: string };

export class Hint {
  f: string; ix: number[]; cut: Array<[number, number]> = []; add: HintAdd = {}; tab: Id | null; ctab: Id | null = null; weak = false; tw: Set<string>;
  ct(): Id | null { return this.tab ?? this.ctab; }
  text: string; B: Brain;
  constructor(text: string, B: Brain) {
    this.text = text; this.B = B;
    [this.f, this.ix] = fmap(text);
    const tl = B.link(tok(text, B.names), null, ["tab"]);
    this.tab = tl.length ? tabOf(maxBy(tl, (h) => h.sc).e) : null;
    const t0 = this.tab; this.tab = tabVote(text, B, this.tab, tl); this.weak = t0 !== null && this.tab === null;
    this.tw = this.tab !== null ? new Set(words(fold(B.T.get(this.tab)?.name))) : new Set();
    const pt = B.ctx.reply?.spec?.tab ?? B.ctx.spec?.tab; // câu nối tiếp ngắn không nêu tab: hiểu trường theo tab của kết quả trước
    this.ctab = this.tab === null && typeof pt === "number" && words(fold(text)).length <= 6 ? pt : null;
  }
  steps(): Array<() => void> { return [() => this.linkcond(), () => this.content(), () => this.time_(), () => this.num(), () => this.owner(), () => this.vals(), () => this.topgroup(), () => this.agg(), () => this.rank(), () => this.group(), () => this.fieldval()]; }
  used(a: number, b: number) { return this.cut.some(([x, y]) => a < y && x < b); }
  accentOk(label: string) { const lo = this.text.toLowerCase(), lb = label.toLowerCase(); return lo.includes(lb) || words(lo).filter((w) => fold(w) === w).join(" ").includes(fold(lb)); }
  eat(a: number, b: number) {
    let ws = this.f.slice(0, a).trimEnd();
    for (;;) { const m = search(String.raw`(?:^|\s)(co|la|ma|deu|duoc|thi|trong|vao|o|tai|thuoc)$`, ws); if (!m || this.used(ms(m, 1), me(m, 1))) break; ws = ws.slice(0, ms(m, 1)).trimEnd(); a = ms(m, 1); }
    this.cut.push([a, b]);
  }
  kindOf(f: QField): string { return f.type === "link" ? "link" : this.B.fprof(f.id).kind || (f.type === "number" ? "num" : f.type === "date" ? "date" : "text"); }
  fields(kinds: readonly string[] | null = null): QField[] { return this.B.fields.filter((f) => (this.ct() === null || f.tab_id === this.ct()) && f.type !== "file" && (kinds === null || kinds.includes(this.kindOf(f)))); }
  /** cụm chữ → trường (khớp mờ tên trường, có từ đồng nghĩa like=thích…); bỏ qua cụm chỉ gồm chữ trong tên tab */
  fieldAt(phrase: string, kinds: readonly string[] | null = null, strict = false): QField | null {
    const ref = this.B.alias[phrase.trim()];
    if (ref?.startsWith("field:") && this.B.F.has(+ref.slice(6))) { const f = this.B.F.get(+ref.slice(6))!, k = this.B.fprof(f.id).kind; if ((this.ct() === null || f.tab_id === this.ct()) && (kinds === null || (k !== undefined && kinds.includes(k)))) return f; }
    let p = words(phrase).map((w) => SYN[w] ?? w).join(" "); p = SYN[phrase.trim()] ?? p;
    if (!p || (words(phrase).every((w) => this.tw.has(w) || STOPW.has(w)) && !this.fields(kinds).some((f) => fold(f.label) === p && this.accentOk(f.label)))) return null;
    let best: [number, QField] | null = null;
    for (const f of this.fields(kinds)) {
      const n = fold(f.label); let sc = sim(p, n, this.B.wt);
      if (!strict && (words(n).includes(p) || (p.length >= 3 && n.includes(p)))) sc = Math.max(sc, 0.8);
      if (sc >= (strict ? 0.85 : 0.7) && (!best || sc > best[0]) && this.accentFit(phrase, f.label)) best = [sc, f];
    }
    return best ? best[1] : null;
  }
  /** cụm vừa khớp có gõ dấu khác với tên trường không (lương/lượng) — tìm cụm gốc trong câu theo vị trí chữ không dấu */
  accentFit(phrase: string, label: string): boolean {
    const k = this.f.indexOf(phrase); if (k < 0 || !phrase) return true;
    const raw = this.text.slice(this.ix[k], this.ix[k + phrase.length - 1] + 1).toLowerCase(), lw = words(label.toLowerCase()).filter((w) => w !== fold(w));
    return words(raw).every((w) => w === fold(w) || !lw.some((x) => fold(x) === fold(w)) || lw.includes(w));
  }
  ref(f: QField): Ref { return this.ct() !== null ? f.id : f.label; }
  where(w: Where) { (this.add.where ??= []).push(w); }
  // 1. nội dung: "nói về X", "có chữ X", "nội dung có X", "không có chữ X"
  content() {
    const sts = this.B.sts.filter((x) => this.ct() === null || x.tab_id === this.ct()).map((x) => resc(fold(x.label))).join("|");
    const V = String.raw`(?<v>"[^"]+"|'[^']+'|.+?)(?=\s+(?:` + STOPS + (sts ? "|" + sts : "") + String.raw`)\b|\s*[,;?.!]|$)`;
    const NG = String.raw`(?<neg>(?:khong|ko|k|chua)\s+(?:co\s+)?)?`;
    const R = [String.raw`\b(?<t>noi dung|bai viet|caption|tieu de|mo ta)\s+` + NG + String.raw`(?:(?:co chua|co|la|bao gom|chua)\s+)?(?:(?:chu|tu khoa|tu|cum tu)\s+)?(?:` + CT + String.raw`\s+)?` + V,
      String.raw`\b` + NG + String.raw`(?<t>noi ve|viet ve|nhac den|nhac toi|lien quan den|lien quan toi|lien quan|co chu|co tu khoa|co tu|co cum tu|co cum|chua chu|chua tu|chua cum tu|chua cum|chu|tu khoa|keyword|ve chu de)\s+` + V,
      String.raw`\b(?:bai|post|tin|nao)\s+(?:[a-z0-9]+\s+){0,2}?(?<t>ve)\s+` + V];
    R.forEach((rx, k) => {
      for (const m of iter(rx, this.f)) {
        const neg0 = gp(m, "neg");
        let a = neg0 && ms(m, "neg") < ms(m, "t") ? ms(m, "neg") : ms(m, "t"); const b = me(m), v0 = ms(m, "v"), v1 = me(m, "v");
        if (k === 0 && /^(?:cua|thuoc|do|cho|tao|dang|duoc|tu|trong|thang|ngay|nam|tuan|hom|live|die)\b/.test(this.f.slice(v0))) continue;
        if (this.used(a, b) || v1 - v0 < 2 || (gp(m, "t") === "chu" && !neg0 && !/(co|chua)\s*$/.test(this.f.slice(0, ms(m, "t"))))) continue;
        const raw = this.text.slice(this.ix[v0], this.ix[v1 - 1] + 1).replace(/^[ "“”'‘’]+|[ "“”'‘’]+$/g, ""), neg = !!neg0;
        let fl = k === 0 ? this.fieldAt(gp(m, "t") ?? "", ["long", "text", "id", "cat"]) : null;
        if (k === 1) { const ws = words(this.f.slice(0, a)); for (const n of [3, 2, 1]) if (ws.length >= n) { const ph = ws.slice(-n).join(" "), f = this.fieldAt(ph, ["long", "text", "id", "cat"], true); if (f) { fl = f; a = a - ph.length - 1; break; } } }
        this.eat(Math.max(0, a), b);
        const ors: Where[] = [];
        for (const pv of raw.split(/\s+(?:hoặc|hoac|hay|or)\s+|\s*\/\s*/).map((x) => x.trim()).filter(Boolean)) {
          const cs = pv.split(/\s+(?:và|va|and)\s+|\s*\+\s*/).map((x) => x.trim()).filter(Boolean).map((av) => this.condFor(fl, av, neg));
          if (!cs.length) throw new Error("ors"); ors.push(cs.length === 1 ? cs[0] : { and: cs });
        }
        if (!ors.length) throw new Error("ors");
        this.where(ors.length === 1 ? ors[0] : { [neg ? "and" : "or"]: ors });
      }
    });
  }
  /** 1 cụm nội dung → điều kiện (trùng giá trị danh mục → danh mục HOẶC nội dung; danh mục + chữ khác → danh mục VÀ nội dung) */
  condFor(fl: QField | null, v: string, neg = false): Where {
    v = v.trim().replace(/^(?:o|tai|trong|cua|la|ve)\s+/i, "").trim();
    if (fl) return { field: this.ref(fl), op: neg ? "not_contains" : "contains", value: v };
    const ctb = this.ct(), cf = ctb !== null ? contentField(this.B.prof, ctb) : null, fv = fold(v);
    let cat: [QField, string] | null = null, rest: string | null = null;
    if (this.ct() !== null) for (const f of this.fields(["cat"])) {
      for (const x of [...(this.B.fprof(f.id).top ?? [])].sort((p, q) => q.length - p.length)) {
        const fx = fold(x); if (fx.length < 3) continue;
        if (fx === fv) { cat = [f, x]; break; }
        const m = new RegExp(`(?<![a-z0-9])${resc(fx)}(?![a-z0-9])`).exec(fv);
        if (m && !neg) { cat = [f, x]; rest = (v.slice(0, m.index) + " " + v.slice(m.index + m[0].length)).trim(); if (!fold(rest).replace(/^(?:o|tai|trong|cua|va)\s+|\s+(?:o|tai|cua|va)$/g, "").trim()) rest = null; break; }
      }
      if (cat) break;
    }
    if (rest && cat) return { and: [this.condFor(null, cat[1]), this.condFor(null, rest.trim().replace(/^(ở|o|tại|tai|trong|của|cua|và|va)\s+/i, ""))] };
    const cc: Where | null = cf !== null && this.B.F.has(cf) ? { field: this.ref(this.B.F.get(cf)!), op: neg ? "not_contains" : "contains", value: v } : null;
    const cw: Where | null = cat ? { field: this.ref(cat[0]), op: neg ? "nin" : "in", value: [cat[1]] } : null;
    if (cc && cw) return { [neg ? "and" : "or"]: [cw, cc] };
    return cc ?? cw ?? { field: "q", q: v };
  }
  // 1a. số: "lượt thích từ 100 đến 200", "trên 500 like", "bình luận dưới 10"
  num() {
    const W = String.raw`(?<f>[a-z]+(?: [a-z]+){0,3}?)`, N = String.raw`(-?\d+(?:[.,]\d+)?)\s*(trieu|tr|nghin|ngan|ty|ti|k)?\b`;
    const R: Array<[string, string, boolean]> = [
      [String.raw`\b(?:luot )?${W}\s+(?:tu|trong khoang|khoang)\s+${N}\s+(?:den|toi|-)\s+${N}`, "between", false],
      [String.raw`\b(?:luot )?${W}\s+(?:co\s+)?(?<o>tren|hon|lon hon|nhieu hon|cao hon|>=|>|it nhat|toi thieu|tu)\s+${N}(?!\s*(?:den|toi|-|/|ngay|thang))`, "op", false],
      [String.raw`\b(?:luot )?${W}\s+(?:co\s+)?(?<o>duoi|it hon|thap hon|nho hon|<=|<|toi da|khong qua)\s+${N}`, "op", false],
      [String.raw`\b(?<o>tren|hon|it nhat|toi thieu|duoi|it hon|toi da)\s+${N}\s+(?:luot\s+)?${W}\b`, "op", true]];
    const mul: Record<string, number> = { k: 1e3, nghin: 1e3, ngan: 1e3, tr: 1e6, trieu: 1e6, ty: 1e9, ti: 1e9 };
    const val = (x: string, u: string) => parseFloat(x.replace(",", ".")) * (mul[u] ?? 1);
    const nums = (s: string) => [...s.matchAll(new RegExp(N, "g"))].map((x) => [x[1], x[2] ?? ""] as [string, string]);
    const OPS: Record<string, string> = { tren: "num_gt", hon: "num_gt", "lon hon": "num_gt", "nhieu hon": "num_gt", "cao hon": "num_gt", ">": "num_gt", ">=": "num_gte", "it nhat": "num_gte", "toi thieu": "num_gte", tu: "num_gte", duoi: "num_lt", "it hon": "num_lt", "thap hon": "num_lt", "nho hon": "num_lt", "<": "num_lt", "<=": "num_lte", "toi da": "num_lte", "khong qua": "num_lte" };
    for (const [rx, kind, rev] of R) for (const m of iter(rx, this.f)) {
      if (this.used(ms(m), me(m))) continue;
      const ws = words(gp(m, "f") ?? ""); let hit: [number, QField] | null = null;
      for (let n = ws.length; n > 0 && !hit; n--) { const x = this.fieldAt((rev ? ws.slice(0, n) : ws.slice(-n)).join(" "), ["num"]); if (x) hit = [n, x]; }
      for (let n = ws.length - 1; n > 0 && !hit && !rev; n--) { const x = this.fieldAt(ws.slice(0, n).join(" "), ["num"]); if (x) hit = [ws.length, x]; } // "số lượng sản phẩm dưới 5": tên trường đứng đầu cụm, sau là chủ ngữ
      if (!hit) continue;
      const [n_, f] = hit;
      const st0 = ms(m, "f") + (!rev && n_ < ws.length ? ws.slice(0, ws.length - n_).join(" ").length + 1 : 0), en0 = rev ? ms(m, "f") + ws.slice(0, n_).join(" ").length : me(m);
      const ns = nums(this.f.slice(ms(m), me(m)));
      if (kind === "between") { let n2 = ns.slice(0, 2); if (n2.length === 2 && !n2[0][1] && n2[1][1]) n2 = [[n2[0][0], n2[1][1]], n2[1]]; this.where({ field: this.ref(f), op: "num_between", value: n2.map((x) => val(...x)).sort((p, q) => p - q) }); }
      else this.where({ field: this.ref(f), op: OPS[gp(m, "o") ?? ""], value: val(...ns[0]) });
      this.eat(st0, en0);
    }
    if (this.ct() === null) return;
    for (const m of iter(String.raw`(?:^|\s)(?<o>tren|hon|lon hon|nhieu hon|duoi|it hon|nho hon|>=|>|<=|<)\s+` + N, this.f)) {
      if (this.used(ms(m, "o"), me(m))) continue;
      const nm = nums(this.f.slice(ms(m, "o"), me(m)))[0];
      if (!nm[1] && !/\d{3}/.test(nm[0])) continue; // "trên 5" quá mơ hồ → để luật cũ
      const v = val(...nm);
      const cs = this.fields(["num"]).filter((f) => !new RegExp(String.raw`sdt|dien thoai|phone|uid|\bid\b|ma\b`).test(fold(f.label)) && (this.B.fprof(f.id).min ?? 0) <= v && v <= (this.B.fprof(f.id).max ?? 0) * 1.5);
      if (cs.length !== 1) continue;
      this.where({ field: this.ref(cs[0]), op: OPS[gp(m, "o") ?? ""], value: v }); this.eat(ms(m, "o"), me(m));
    }
  }
  // 0. "fb chưa có email", "fb không có proxy", "page có admin phụ" → trường (liên kết) trống / có
  linkcond() {
    const T0 = tok(this.text, this.B.names), tl = this.B.link(clone(T0), null, ["tab"]).sort((x, y) => x.i - y.i);
    const rx = String.raw`(?:^|\s)(?<w>chua co|khong co|ko co|k co|chua|thieu|da co|co|kem)\s+(?<x>[a-z0-9]+(?: [a-z0-9]+){0,3}?)(?=\s*$|\s*[,;?.!]|\s+(?:va|hoac|cua|thuoc|nhung|ma|o|tai|trong|tao|sua|nao|khong|chua|co|live|die)\b)`;
    for (const m of iter(rx, this.f)) {
      if (this.used(ms(m, "w"), me(m))) continue;
      const ph = gp(m, "x") ?? "", neg = ["chua co", "khong co", "ko co", "k co", "chua", "thieu"].includes(gp(m, "w") ?? "");
      let subj = this.tab;
      if (tl.length) { const pre = tl.filter((h) => this.ix.length && T0.slice(0, h.i).map((x) => x.n).join(" ").length < ms(m, "w")); if (pre.length) subj = tabOf(pre[0].e); }
      if (subj === null) continue;
      const fs = this.B.fields.filter((f) => f.tab_id === subj && f.type !== "file");
      let f = fs.find((x) => fold(x.label) === ph);
      if (!f) { const th = this.B.link(tok(ph, this.B.names), null, ["tab"]); if (th.length && th[0].sc >= 0.85) { const lt = tabOf(th[0].e); f = fs.find((x) => x.type === "link" && x.link_tab === lt); } }
      if (!f) f = fs.find((x) => ["link", "secret", "text", "url"].includes(x.type) && sim(ph, fold(x.label), this.B.wt) >= 0.85);
      if (!f || (!neg && !["link", "secret", "url", "file"].includes(f.type))) continue;
      this.tab = subj; this.tw = new Set(words(fold(this.B.T.get(subj)?.name)));
      this.cut.push([ms(m, "w"), me(m)]);
      this.where({ field: f.id, op: neg ? "empty" : "not_empty" });
    }
  }
  // 1d. "của An", "thuộc Cường" → owner (ưu tiên hơn tình trạng trùng chữ như "Ẩn")
  owner() {
    if (/^(?:hay |giup |vui long )?(?:doi|chuyen|giao|gan|cap nhat|sua|dat|update|set|ghi chu|ghi|bo sung|xoa|go bo|loai bo|them|tao|nhap)\b/.test(this.f)) return; // lệnh: để luật lệnh tách "của Hải" (lọc / owner dòng mới) và "cho Cường" (người nhận)
    for (const m of iter(String.raw`\b(?<w>cua|thuoc|do|cho)\s+(?<n>[a-z]+(?: [a-z]+){0,3})`, this.f)) {
      const ws = words(gp(m, "n") ?? "");
      for (let n = ws.length; n > 0; n--) {
        const ph = ws.slice(0, n).join(" ");
        if (this.used(ms(m, "n"), ms(m, "n") + ph.length) || STOPW.has(ph)) continue;
        const hs = this.B.pool(null, ["owner"]).filter((e) => e.n.some((nm) => sim(ph, nm, this.B.wt) >= (n === 1 ? 0.88 : 0.8)));
        if (hs.length) {
          let ex = hs.filter((e) => e.n.some((nm) => nm === ph || words(nm).slice(-1)[0] === ph)); if (!ex.length) ex = hs;
          this.eat(ms(m), ms(m, "n") + ph.length);
          this.add.owner = ex.map((e) => (e.k === "owner" ? e.o.id : 0)).filter(Boolean);
          return;
        }
      }
    }
  }
  // 1c. "top 5 nhóm đăng nhiều bài nhất", "chủ đề nào nhiều bài nhất" → nhóm + đếm
  topgroup() {
    const rx = String.raw`\b(?:top\s+(?<n>\d+)\s+)?(?<f>[a-z]+(?: [a-z]+){0,2}?)\s+(?<nao>nao\s+)?(?:co\s+)?(?<d>nhieu|it)\s+(?<x>(?:bai|dong|tai khoan|acc|post|tin)?\s*(?:[a-z]+\s+)?)nhat\b`;
    for (const m of iter(rx, this.f)) {
      if (this.used(ms(m), me(m))) continue;
      const ws = words(gp(m, "f") ?? ""), x_ = (gp(m, "x") ?? "").trim();
      if (x_.length >= 3) { const th = this.B.link(tok(x_, this.B.names), null, ["tab"]); if (th.length && th[0].sc >= 0.9) { this.tab = tabOf(th[0].e); this.tw = new Set(words(fold(this.B.T.get(this.tab)?.name))); } }
      const bad = (x: QField) => ["num", "long", "id", "secret", "date"].includes(this.B.fprof(x.id).kind ?? "");
      const phs = [...Array.from({ length: ws.length }, (_, k) => ws.slice(-(ws.length - k)).join(" ")), ...Array.from({ length: Math.max(0, ws.length - 1) }, (_, k) => ws.slice(0, ws.length - 1 - k).join(" "))];
      const fs_ = phs.map((p) => this.fieldAt(p)).filter((x): x is QField => !!x);
      let f = fs_.find((x) => !bad(x)) ?? null;
      if (!f && fs_.length) { const w0 = new Set(words(fold(fs_[0].label)).filter((w) => !["uid", "id", "ma", "link", "url"].includes(w))); f = this.fields().find((x) => x.tab_id === fs_[0].tab_id && !bad(x) && words(fold(x.label)).some((w) => w0.has(w))) ?? null; if (f && this.tab === null) this.tab = f.tab_id; }
      const gk = GBY[ws.slice(-2).join(" ")] || GBY[ws[ws.length - 1]];
      if (!f && !gk) continue;
      this.eat(ms(m), me(m));
      this.add.group = { by: gk || this.ref(f!), top: +(gp(m, "n") || (gp(m, "nao") ? 1 : 10)), ...(gp(m, "d") === "it" ? { order: "asc" } : {}) };
      return;
    }
  }
  // 1b. giá trị có thật trong dữ liệu (danh mục học được): "nhóm Hội mua bán Quận 7", "chủ đề du lịch"
  vals() {
    const cands: Array<[number, string, string, QField, boolean]> = [];
    for (const f of this.fields(["cat"])) for (const v of this.B.fprof(f.id).top ?? []) {
      const fv = fold(v);
      if (fv.length >= 3 && !STOPW.has(fv) && !["khong", "chua", "roi", "xong", "co", "nam", "thang", "ngay"].includes(fv)) cands.push([fv.length, fv, v, f, false]);
      const ws = words(fv); if (ws.length >= 2 && ws.every((w) => new RegExp("^\\p{L}", "u").test(w))) cands.push([ws.length, ws.map((w) => w[0]).join(""), v, f, true]);
    }
    const got = new Map<string, [QField, boolean, string[]]>();
    for (const [, fv, v, f, isAb] of [...cands].sort((x, y) => Number(x[4]) - Number(y[4]) || y[0] - x[0])) {
      for (const m of iter(`(?<![a-z0-9])${resc(fv)}(?![a-z0-9])`, this.f)) {
        if (this.used(ms(m), me(m))) continue;
        if (isAb) { const raw = this.text.slice(this.ix[ms(m)], this.ix[me(m) - 1] + 1); if ((fv.length < 3 && !isUpper(raw)) || STOPW.has(fv) || NOISE.has(fv)) continue; }
        let a = ms(m); const ws = words(this.f.slice(0, a)), lw = new Set(words(fold(f.label)));
        let k = 0; while (k < Math.min(3, ws.length) && lw.has(ws[ws.length - 1 - k])) k++;
        if (k) a -= ws.slice(-k).join(" ").length + 1;
        else if (!isAb && words(fv).some((w) => this.tw.has(w)) && !this.f.slice(0, a).replace(/\b(?:cac|nhung|danh sach|tim|loc|xem|lay|liet ke|cho|toi|minh|bao nhieu|so|dem|tat ca|giup)\b/g, "").trim()) { this.cut.push([ms(m), me(m)]); break; }
        const ng = search(String.raw`(?:^|\s)(khong phai(?: la| o| tai| thuoc)?|khong (?:o|tai|thuoc|la|co|dung|qua|bang|lay|phai)|khong|ko|ngoai|tru|khac|bo)\s+(?:(?:o|tai|la|thuoc)\s+)?$`, this.f.slice(0, a));
        const neg = !!ng && !this.used(ms(ng, 1), me(ng, 1)); if (neg && ng) a = ms(ng, 1);
        this.eat(a, me(m));
        const key = `${f.id}|${neg}`; (got.get(key) ?? got.set(key, [f, neg, []]).get(key)!)[2].push(v);
        break;
      }
    }
    for (const [f, neg, vs] of got.values()) this.where({ field: this.ref(f), op: neg ? "nin" : "in", value: vs });
    for (const m of iter(String.raw`(?:^|\s)(hoac|hay|hoac la|voi|va|,|/)(?=\s)`, this.f)) { const a = ms(m, 1), b = me(m, 1); if (!this.used(a, b) && this.used(a - 3, a - 1) && this.used(b + 1, b + 3)) this.cut.push([a, b]); }
  }
  // 1e. "<tên trường> <giá trị>": "tên Lan", "mã SKU00123", "email abc@x" → trường đó chứa giá trị
  fieldval() {
    const lo = this.text.toLowerCase(), rawws = new Map<string, string>(); for (const w of lo.match(/[^\s,;:=]+/g) ?? []) rawws.set(fold(w), w);
    const acc = (w: string, lw: string) => { const r = rawws.get(w); return r === undefined || r === lw || fold(r) === r; };
    const fs = this.fields(["text", "id", "long", "cat"]), cnt = new Map<string, number>();
    for (const f of fs) for (const w of new Set(words(fold(f.label)))) cnt.set(w, (cnt.get(w) ?? 0) + 1);
    const vw = new Set([...VERBS.flatMap(([, ws]) => ws.flatMap(words)), "giao", "dat", "gan", "chuyen", "doi"]);
    const pats: Array<[number, string, QField, boolean]> = [];
    for (const f of fs) {
      const lab = fold(f.label), lw = words(f.label.toLowerCase());
      if (!words(lab).every((w) => this.tw.has(w))) pats.push([lab.length, lab, f, true]);
      words(lab).forEach((w, k) => { const w0 = lw[k] ?? w; if (w.length >= 2 && cnt.get(w) === 1 && !this.tw.has(w) && !STOPW.has(w) && !vw.has(w) && acc(w, w0) && lab !== w) pats.push([w.length, w, f, false]); });
    }
    const stw = new Set([...this.B.sts.flatMap((x) => words(fold(x.label))), "trung", "lap", "can", "chua", "khong", "ko", "co", "het", "moi", "cu"]);
    const cap0 = (i: number) => /^[A-ZĐ]/.test(this.text[this.ix[i]] ?? "");
    for (const [, ph, f, full] of [...pats].sort((x, y) => y[0] - x[0])) {
      for (const m of iter(`(?<![a-z0-9])${resc(ph)}\\s*(?:la\\s+|=\\s*|:\\s*|\\s)(?<v>[^\\s,;]+(?:\\s+[^\\s,;]+){0,3})`, this.f)) {
        const vs0 = ms(m, "v"); if (this.used(ms(m), vs0)) continue;
        const vs: Array<[string, number, number]> = []; let b = vs0;
        for (const w of iter(String.raw`[^\s,;]+`, this.f.slice(vs0, me(m, "v")))) {
          const g = w[0], a1 = vs0 + w.index, b1 = a1 + g.length;
          let soft = full && vs.length > 0 && STOPW.has(g) && !["cua", "thuoc", "trong", "cho", "tai", "da", "dang", "bi", "duoc", "co"].includes(g);
          soft = soft || (full && vs.length > 0 && NOISE.has(g) && !["va", "hoac", "cua", "thuoc", "voi", "ma", "nhung", "tu", "den", "theo"].includes(g));
          const cap = !stw.has(g) && cap0(a1) && this.ix[a1] > 0;
          if (this.used(a1, b1) || ((STOPW.has(g) || NOISE.has(g)) && !soft && !cap) || stw.has(g) || /^(?:tren|duoi|tu|den|truoc|sau|nhieu|it|cao|thap)$/.test(g)) break;
          vs.push([g, w.index, w.index + g.length]); b = b1;
        }
        while (vs.length && (STOPW.has(vs[vs.length - 1][0]) || NOISE.has(vs[vs.length - 1][0])) && !cap0(vs0 + vs[vs.length - 1][1])) { vs.pop(); b = vs.length ? vs0 + vs[vs.length - 1][2] : b; }
        if (!vs.length) continue;
        const raw = this.text.slice(this.ix[vs0], this.ix[b - 1] + 1).replace(/^[ "“”']+|[ "“”']+$/g, ""), fr = words(fold(raw));
        const labs = this.B.fields.filter((x) => x.tab_id === f.tab_id).map((x) => ` ${fold(x.label)} `);
        if (fr.some((_, k) => fr.slice(k, k + 2).length === 2 && labs.some((L) => L.includes(` ${fr.slice(k, k + 2).join(" ")} `)))) continue; // trong giá trị có tên trường khác
        const lw = words(fold(f.label));
        if (lw.includes(fr[0]) || fr.every((w) => lw.includes(w)) || this.B.fields.some((x) => x.tab_id === f.tab_id && fold(x.label).startsWith(fold(raw)))) continue; // giá trị lại là tên trường
        const ctb = this.ct(); if (ctb === null) this.tab = f.tab_id; else if (f.tab_id !== ctb) continue;
        this.eat(ms(m), b);
        const ex = (this.B.fprof(f.id).top ?? []).find((v) => fold(v) === fold(raw));
        this.where(ex !== undefined ? { field: this.ref(f), op: "in", value: [ex] } : { field: this.ref(f), op: "contains", value: raw });
        break;
      }
    }
  }
  // 2. thời gian
  dfield(a: number, b: number): Ref {
    const o = Math.max(0, a - 25), near = this.f.slice(o, b + 15);
    for (const f of this.fields(["date"])) { const lw = words(fold(f.label)).filter((w) => w.length > 2 && w !== "ngay"); if (lw.length && near.includes(lw.join(" ")) && !lw.every((w) => ["tao", "them", "nhap", "sua", "cap", "nhat", "doi"].includes(w))) return this.ref(f); }
    for (const [rx, k] of [[String.raw`\b(?:duoc |da |moi )?(?:tao|them|nhap)\b`, "created"], [String.raw`\b(?:duoc |da )?(?:cap nhat|sua|doi)\b`, "updated"]] as const) {
      const m = search(rx, near);
      if (m) { if (!this.text.includes(":") && !this.used(o + ms(m), o + me(m))) this.cut.push([o + ms(m), o + me(m)]); return k; }
    }
    const ds = this.fields(["date"]);
    for (const f of ds) if (words(fold(f.label)).some((w) => w.length > 2 && w !== "ngay" && words(near).includes(w))) return this.ref(f);
    return ds.length ? this.ref(ds[0]) : "created";
  }
  time_() {
    const now = new Date(), Y = now.getFullYear(), Mo = now.getMonth() + 1, D = now.getDate(), wd = (now.getDay() + 6) % 7;
    const P2 = (n: number) => String(n).padStart(2, "0"), day = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${P2(m)}-${P2(d)}`;
    const nxt = (y: number, m: number): [number, number] => [y + (m === 12 ? 1 : 0), m === 12 ? 1 : m + 1];
    const ymd = (t: number) => { const d = new Date(t * 1000); return day(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
    const today0 = new Date(Y, Mo - 1, D).getTime() / 1000;
    const dm = String.raw`(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?`;
    const pd = (g1?: string, g2?: string, g3?: string): string | null => { const d = +(g1 ?? 0), m = +(g2 ?? 0); let y = g3 ? +g3 : m < Mo || (m === Mo && d <= D) ? Y : Y - 1; if (y < 100) y += 2000; return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? day(y, m, d) : null; };
    const plus1 = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return ymd(new Date(y, m - 1, d).getTime() / 1000 + 86400 + 3600); };
    const R: Array<[string, (m: RegExpExecArray) => [string | null, string | null]]> = [
      [String.raw`\bhom nay\b`, () => [ymd(today0), ymd(today0 + 86400 + 3600)]],
      [String.raw`\bhom qua\b`, () => [ymd(today0 - 86400 + 3600), ymd(today0)]],
      [String.raw`\bhom kia\b`, () => [ymd(today0 - 2 * 86400 + 3600), ymd(today0 - 86400 + 3600)]],
      [String.raw`\btuan nay\b`, () => [ymd(today0 - wd * 86400 + 3600), null]],
      [String.raw`\btuan (?:truoc|roi)\b`, () => [ymd(today0 - (wd + 7) * 86400 + 3600), ymd(today0 - wd * 86400 + 3600)]],
      [String.raw`\bthang nay\b`, () => [day(Y, Mo, 1), null]],
      [String.raw`\bthang (?:truoc|roi)\b`, () => [day(Y - (Mo === 1 ? 1 : 0), Mo === 1 ? 12 : Mo - 1, 1), day(Y, Mo, 1)]],
      [String.raw`\bnam nay\b`, () => [day(Y, 1, 1), null]],
      [String.raw`\bnam (?:ngoai|truoc|roi)\b`, () => [day(Y - 1, 1, 1), day(Y, 1, 1)]],
      [String.raw`\btu (?:ngay )?` + dm + String.raw` (?:den|toi|-) (?:ngay )?` + dm, (m) => { const e = pd(m[4], m[5], m[6]); return [pd(m[1], m[2], m[3]), e && plus1(e)]; }],
      [String.raw`\b(?:truoc|truoc ngay) ` + dm, (m) => [null, pd(m[1], m[2], m[3])]],
      [String.raw`\b(?:sau|tu|ke tu|tu ngay) ` + dm + String.raw`(?: (?:tro di|tro lai day|den nay))?`, (m) => [pd(m[1], m[2], m[3]), null]],
      [String.raw`\bngay ` + dm, (m) => { const x = pd(m[1], m[2], m[3]); return [x, x && plus1(x)]; }],
      [String.raw`\bthang (\d{1,2})(?:[/ -](\d{4})| nam (\d{4}))?\b`, (m) => { const mo = +m[1], y = +(m[2] || m[3] || (mo <= Mo ? Y : Y - 1)); return mo >= 1 && mo <= 12 ? [day(y, mo, 1), day(...nxt(y, mo), 1)] : [null, null]; }],
      [String.raw`\bnam (\d{4})\b`, (m) => [day(+m[1], 1, 1), day(+m[1] + 1, 1, 1)]],
      [String.raw`\b(?:trong|trong vong)? ?(\d+) (ngay|tuan|thang|nam) (?:qua|gan day|gan nhat|vua qua|tro lai day|truoc)\b`, (m) => [ymd(today0 - (+m[1] * ({ ngay: 1, tuan: 7, thang: 30, nam: 365 } as Record<string, number>)[m[2]] - 1) * 86400 + 3600), null]],
    ];
    for (const [rx, fn] of R) for (const m of iter(rx, this.f)) {
      const a = ms(m), b = me(m); if (this.used(a, b)) continue;
      let lo: string | null, hi: string | null; try { [lo, hi] = fn(m); } catch { continue; }
      if (lo === null && hi === null) continue;
      const fr = this.dfield(a, b); this.eat(a, b);
      if (lo) this.where({ field: fr, op: "after", value: lo });
      if (hi) this.where({ field: fr, op: "before", value: hi });
    }
  }
  // 3. xếp hạng: "nhiều like nhất", "lượt thích cao nhất", "mới nhất"
  rank() {
    if (/\b(tong|trung binh|binh quan)\b/.test(this.f) || /(cao|lon|nho|thap) nhat (la )?bao nhieu/.test(this.f)) return;
    const hi = "(?:nhieu|cao|lon|dong|manh|hot)", lo = "(?:it|thap|nho|kem|yeu)";
    const one = /\b(nao|cai nao|dong nao)\b|^ai\b/.test(this.f) && !/\b(top|nhung|cac)\b/.test(this.f);
    const mm = search(String.raw`\b(?<a>re|dat|mac)\s+nhat\b|\b(?<g>gia tri|gia tien|so tien|gia|tien)\s+(?<d>cao|lon|nhieu|thap|nho|it)\s+nhat\b`, this.f);
    if (mm && !this.used(ms(mm), me(mm))) {
      const d = gp(mm, "a") === "re" || ["thap", "nho", "it"].includes(gp(mm, "d") ?? "") ? "asc" : "desc", ctb = this.ct(), f = ctb !== null ? money(this.B, ctb) : null;
      this.eat(ms(mm), me(mm));
      if (f) this.add.sort = { field: this.ref(f), dir: d }; else this.add._money = d;
      if (one) this.add.limit = 1;
      return;
    }
    const W = String.raw`(?<f>[a-z0-9]+(?: [a-z0-9]+){0,3}?)`;
    for (const [rx, d, side] of [[String.raw`\b${hi} (?:luot )?${W} nhat\b`, "desc", 0], [String.raw`\b${lo} (?:luot )?${W} nhat\b`, "asc", 0], [String.raw`\b(?:luot )?(?<f>[a-z0-9]+(?: [a-z0-9]+){0,2}) ${hi} nhat\b`, "desc", 1], [String.raw`\b(?:luot )?(?<f>[a-z0-9]+(?: [a-z0-9]+){0,2}) ${lo} nhat\b`, "asc", 1]] as const) {
      for (const m of iter(rx, this.f)) {
        if (this.used(ms(m), me(m))) continue;
        const ws = words(gp(m, "f") ?? ""); let f: QField | null = null;
        for (let n = Math.min(3, ws.length); n > 0 && !f; n--) f = this.fieldAt((side ? ws.slice(-n) : ws.slice(0, n)).join(" "), ["num"]);
        if (!f) continue;
        this.eat(ms(m), me(m)); this.add.sort = { field: this.ref(f), dir: d };
        if (/\b(nao|cai nao|bai nao|dong nao)\b|^ai\b/.test(this.f) && !/\b(top|nhung|cac)\b/.test(this.f)) this.add.limit = 1;
        return;
      }
    }
    const m2 = search(String.raw`\bmoi (?:duoc )?(?:tao|them|nhap|dang|cap nhat|sua|dat|ky|vao)\b`, this.f);
    if (m2 && !this.used(ms(m2), me(m2)) && ["mới", "moi"].includes(this.text.slice(this.ix[ms(m2)], this.ix[ms(m2)] + 3).toLowerCase())) { // "mới tạo" (không phải "mỗi")
      const fr = this.dfield(ms(m2), me(m2)); this.eat(ms(m2), me(m2)); this.add.sort = { field: fr, dir: "desc" }; return;
    }
    for (const [rx, d] of [[String.raw`\b(?:moi nhat|gan day nhat|gan nhat)\b`, "desc"], [String.raw`\b(?:cu nhat|lau nhat|dau tien)\b`, "asc"]] as const) {
      const m = search(rx, this.f);
      if (m && !this.used(ms(m), me(m))) { this.eat(ms(m), me(m)); const ds = this.fields(["date"]); this.add.sort = { field: ds.length && !/\btao\b/.test(this.f) ? this.ref(ds[0]) : "created", dir: d }; return; }
    }
  }
  // 4. tổng / trung bình / lớn nhất của trường số
  agg() {
    for (const m of iter(String.raw`\b(?<fn>tong(?: so)?|trung binh|binh quan|tb|lon nhat|cao nhat|nho nhat|thap nhat|max|min|sum|avg)\s+(?:cua\s+|so\s+|la\s+)?(?:luot\s+)?(?<f>[a-z0-9]+(?: [a-z0-9]+){0,3})`, this.f)) {
      const fn = gp(m, "fn") ?? "";
      if (["lon nhat", "cao nhat", "nho nhat", "thap nhat", "max", "min"].includes(fn) && !/bao nhieu|la may|la gi|\?/.test(this.f)) continue;
      const ws = words(gp(m, "f") ?? ""); let k = 0, f: QField | null = null;
      for (let n = Math.min(3, ws.length); n > 0; n--) { f = this.fieldAt(ws.slice(0, n).join(" "), ["num"]); if (f) { k = n; break; } }
      if (!k || !f) continue;
      this.eat(ms(m), ms(m, "f") + ws.slice(0, k).join(" ").length);
      this.add.agg = { fn: fn.startsWith("tong") || fn === "sum" ? "sum" : ["trung binh", "binh quan", "tb", "avg"].includes(fn) ? "avg" : ["lon nhat", "cao nhat", "max"].includes(fn) ? "max" : "min", field: this.ref(f) };
      return;
    }
    for (const m of iter(String.raw`\b(?:luot )?(?<f>[a-z0-9]+(?: [a-z0-9]+){0,2}) (?<fn>trung binh|binh quan|tb)\b`, this.f)) {
      const ws = words(gp(m, "f") ?? ""); let f: QField | null = null;
      for (let n = Math.min(3, ws.length); n > 0 && !f; n--) f = this.fieldAt(ws.slice(-n).join(" "), ["num"]);
      if (f && !this.used(ms(m), me(m))) { this.eat(ms(m), me(m)); this.add.agg = { fn: "avg", field: this.ref(f) }; return; }
    }
    for (const m of iter(String.raw`\b(?:luot )?(?<f>[a-z0-9]+(?: [a-z0-9]+){0,2}) (?<fn>cao|lon|nhieu|nho|thap|it) nhat (?:la )?(?:bao nhieu|may)`, this.f)) {
      const ws = words(gp(m, "f") ?? ""); let f: QField | null = null;
      for (let n = Math.min(3, ws.length); n > 0 && !f; n--) f = this.fieldAt(ws.slice(-n).join(" "), ["num"]);
      if (f) { this.eat(ms(m), me(m)); this.add.agg = { fn: ["cao", "lon", "nhieu"].includes(gp(m, "fn") ?? "") ? "max" : "min", field: this.ref(f) }; return; }
    }
  }
  // 5. nhóm: "theo chủ đề", "theo tháng", "mỗi nhóm đăng", "phân bố X"
  group() {
    for (const m of iter(String.raw`\b(?<w>theo|moi|tung|phan bo|ti le|ty le|chia theo|nhom theo|thong ke theo|phan theo)\s+(?<f>[a-z ]{2,30}?)(?=\s+(?:co|la|nao|bao|thi|duoc|cua|trong|tu|va)\b|\s*[,?.]|$)`, this.f)) {
      const a = ms(m), b = me(m), pre = this.f.slice(Math.max(0, a - 8), a);
      if (this.used(a, b) || /(xep|sap)\s*$/.test(pre)) continue;
      if (gp(m, "w") === "moi" && ["mới", "mơi", "mời"].includes(this.text.slice(this.ix[a], this.ix[a] + 3).toLowerCase())) continue; // "mới" (vừa) không phải "mỗi"
      const ph = (gp(m, "f") ?? "").trim(), um = /^(ngay|tuan|thang|nam)(?:\s+(.+))?$/.exec(ph);
      if (um) {
        const unit = ({ ngay: "day", tuan: "week", thang: "month", nam: "year" } as Record<string, string>)[um[1]];
        let fr: Ref; if (!um[2]) fr = this.dfield(a, b); else { const f = this.fieldAt(um[2], ["date"]); fr = f ? this.ref(f) : "created"; }
        this.eat(a, b); this.add.group = { by: fr, unit, order: "desc" }; return;
      }
      const g = GBY[ph] || GBY[words(ph).slice(0, 2).join(" ")];
      if (g) { if (gp(m, "w") === "moi" || gp(m, "w") === "tung") continue; this.eat(a, b); this.add.group = { by: g }; return; } // "mỗi owner" → để luật cũ lo
      const ws = words(ph), subs: Array<[number, number, string]> = [];
      for (let a_ = 0; a_ < ws.length; a_++) for (let b_ = a_ + 1; b_ <= Math.min(ws.length, a_ + 3); b_++) subs.push([b_ - a_, a_, ws.slice(a_, b_).join(" ")]);
      subs.sort((x, y) => y[0] - x[0] || x[1] - y[1]);
      let f: QField | null = null; for (const [, , p] of subs) { const x = this.fieldAt(p); if (x && !["long", "id", "secret"].includes(this.B.fprof(x.id).kind ?? "")) { f = x; break; } }
      if (f) { this.eat(a, b); this.add.group = { by: this.ref(f) }; return; }
    }
  }
  /** câu sau khi bỏ phần đã hiểu (giữ nguyên chữ gốc; phần đã hiểu → từ đệm "giup") */
  rest(): string {
    const keep = new Array<boolean>(this.text.length).fill(true);
    for (const [a, b] of this.cut) { const end = b - 1 < this.ix.length ? this.ix[b - 1] + 1 : this.text.length; for (let i = this.ix[a]; i < end; i++) keep[i] = false; }
    let out = "", prev = true;
    for (let i = 0; i < this.text.length; i++) { if (keep[i]) out += this.text[i]; else if (prev) out += " giup "; prev = keep[i]; }
    const r = out.replace(/\s+/g, " ").trim();
    return r.replace(/\bgiup\b/g, "").trim() ? r : "";
  }
}
/** → [câu còn lại cho luật cũ, phần đã hiểu {where, sort, group, agg, limit, owner, q, _tab…}] */
export function hint(text: string, B: Brain): [string, HintAdd] {
  if (!text || text.trim().includes("\n") || text.length > 400 || (/^\s*(?:them|tao|nhap)\b/.test(fold(text)) && text.includes(":"))) return [text, {}]; // thêm hàng loạt: phần sau ":" là dữ liệu
  let h: Hint; try { h = new Hint(text, B); } catch { return [text, {}]; }
  for (const step of h.steps()) { try { step(); } catch { /* một bước lỗi không làm hỏng cả câu */ } }
  if (!Object.keys(h.add).length) return [text, {}];
  const wh = h.add.where ?? [], qs = wh.filter((w) => w.field === "q").map((w) => str(w.q));
  h.add.where = wh.filter((w) => w.field !== "q"); if (!h.add.where.length) h.add.where = null;
  if (qs.length) h.add.q = qs.join(" ");
  h.add._tab = h.tab;
  if (h.weak && h.tab === null) { // tên tab chỉ khớp lờ mờ: tab = tab duy nhất chứa các trường vừa hiểu
    const fids = [...(h.add.where ?? []).flatMap((w) => [...leaves(w)].map((x) => x.field)), ...[h.add.sort, h.add.agg].filter(Boolean).map((x) => x!.field)], ts = new Set<Id>();
    for (const f of fids) { if (typeof f === "number" && B.F.has(f)) ts.add(B.F.get(f)!.tab_id); else if (typeof f === "string") for (const y of B.fields) if (fold(y.label) === fold(f)) ts.add(y.tab_id); }
    if (ts.size === 1) h.add._tabf = [...ts][0];
  }
  const out: HintAdd = {}; for (const [k, v] of Object.entries(h.add)) if (v !== null && v !== undefined) out[k] = v;
  return [h.rest(), out];
}
/** "chỉ" (= thôi) khác "chi" (chi phí, chi tiêu) — so dạng có dấu */
const isOnly = (text: string) => { const ws = words(text.toLowerCase().replace(/[,;?.!]/g, " ")); return ws.some((w, k) => w === "chỉ" || (w === "chi" && !["phi", "tieu", "tiet", "nhanh", "tra", "tiền", "phí", "tiêu", "tiết", "nhánh", "trả"].includes(ws[k + 1] ?? ""))); };
/** gộp phần đã hiểu vào kế hoạch của luật cũ; câu ngắn không nêu tab sau một kết quả = lọc tiếp */
export function mergeHint(pl: Plan, add: HintAdd, B: Brain, ctx: Ctx = {}, text = ""): Plan {
  let sp = (pl.spec ??= {});
  const tw = new Set(add._tab !== undefined && add._tab !== null && B.T.has(add._tab) ? words(fold(B.T.get(add._tab)!.name)) : []);
  if (typeof sp.tab === "number" && B.T.has(sp.tab)) for (const w of words(fold(B.T.get(sp.tab)!.name))) tw.add(w);
  if (sp.q && words(str(sp.q)).every((w) => NOISE.has(fold(w)) || STOPW.has(fold(w)) || FILL.has(fold(w)) || tw.has(fold(w)))) delete sp.q;
  const prev = ctx.reply?.spec || ctx.spec || null, ft = ` ${fold(text)} `;
  const follow = !!ctx.reply || words(ft).length <= 3 || / (thoi|nua|trong do|trong so do|loc tiep|loc them|them|con lai|ma|cung) /.test(ft) || (/ chi /.test(ft) && isOnly(text)) || /^ (va|con|nhung|roi|theo|nhieu|it|cao|thap|moi|cu|top) /.test(ft);
  if (prev && Object.keys(add).length && follow && !pl.ctx && (add._tab === undefined || add._tab === null) && (sp.tab === undefined || sp.tab === null) && (pl.it === "search" || pl.it === "count")) {
    pl.ctx = true;
    const base = jc(prev); add = { ...add, _tab: (base.tab as Id | undefined) ?? null };
    for (const [k, v] of Object.entries(sp)) base[k] = k !== "where" ? v : [...(base.where ?? []), ...(v as Where[])];
    sp = pl.spec = base;
  }
  if (add._tab !== undefined && add._tab !== null && (sp.tab === undefined || sp.tab === null)) sp.tab = add._tab;
  if (add._tabf !== undefined && !pl.ctx) sp.tab = add._tabf;
  const refs: O[] = [...(add.where ?? []).flatMap((w) => [...leaves(w)]), ...[add.sort, add.agg].filter((x): x is O => !!x)];
  if (add.group) refs.push(add.group);
  const key = (x: O) => ("by" in x ? "by" : "field");
  if (sp.tab === undefined || sp.tab === null) { // không nêu tab: suy ra từ các trường vừa dùng
    let ts: Set<Id> | null = null;
    for (const x of refs) {
      const f = x[key(x)]; let t: Set<Id>;
      if (typeof f === "number" && B.F.has(f)) t = new Set([B.F.get(f)!.tab_id]);
      else if (typeof f === "string" && !isVirt(f) && !GBYV.has(f)) t = new Set(B.fields.filter((y) => fold(y.label) === fold(f)).map((y) => y.tab_id));
      else continue;
      const cur = ts as Set<Id> | null; ts = cur === null ? t : new Set([...cur].filter((v) => t.has(v)));
    }
    if (ts && ts.size === 1) sp.tab = [...ts][0];
  }
  if (typeof sp.tab === "number") for (const x of refs) { const f = x[key(x)]; if (typeof f === "string" && !isVirt(f) && !GBYV.has(f)) { const k = B.fields.find((y) => y.tab_id === sp.tab && fold(y.label) === fold(f)); if (k) x[key(x)] = k.id; } }
  if (add.where) sp.where = [...(sp.where ?? []), ...add.where];
  if (add.q) sp.q = (str(sp.q) + " " + add.q).trim();
  for (const k of ["sort", "group", "agg", "limit"]) if (tru(add[k]) && !tru(sp[k])) sp[k] = add[k];
  if (add._money && typeof sp.tab === "number" && B.T.has(sp.tab) && !tru(sp.sort)) { const f = money(B, sp.tab); if (f) sp.sort = { field: f.id, dir: add._money === "asc" ? "asc" : "desc" }; }
  if (add.owner?.length && blank(sp.owner)) sp.owner = add.owner.length === 1 ? add.owner[0] : add.owner;
  if (add.agg && add.group) pl.it = "search";
  const rest = (pl.rest ?? []).filter((w) => fold(w).length > 1 && !STOPW.has(fold(w)) && !FILL.has(fold(w)) && !NOISE.has(fold(w)));
  if (rest.length && (pl.it === "search" || pl.it === "count") && !sp.q && sp.tab !== undefined && sp.tab !== null && !pl.ctx) { sp.q = rest.join(" "); add = { ...add, q: sp.q }; }
  if (Object.keys(add).length) pl.low = false;
  pl.rest = rest.slice(0, 4); pl.unsure = rest.length > 0 && !!pl.unsure;
  return pl;
}

