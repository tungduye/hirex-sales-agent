import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../server/owl-rules.ts";
import * as H from "../server/owl-hint.ts";
import * as Q from "../server/owl-query.ts";

/* Dữ liệu mẫu nhiều lĩnh vực: tài khoản (Facebook ↔ Email), nhân sự (Lương), kho hàng (Số lượng · Giá), bài đăng (nội dung dài),
   khách hàng (tình trạng "Mới" · trường "Chi phí") — đủ để thử các bẫy bỏ dấu lương/lượng, trùng/trung bình, mới/mỗi, chi/chỉ, nháp/nhập. */
function fixture() {
  const tabs = [{ id: 1, name: "Facebook", icon: "facebook" }, { id: 2, name: "Email", icon: "mail" }, { id: 3, name: "Nhân sự", icon: "users" }, { id: 4, name: "Kho hàng", icon: "box" }, { id: 5, name: "Bài đăng", icon: "note" }, { id: 6, name: "Khách hàng", icon: "user" }];
  const F = (id, tab_id, label, type = "text", o = {}) => ({ id, tab_id, label, type, opts: o.opts || "", link_tab: o.link_tab ?? null, pos: id });
  const fields = [F(11, 1, "UID"), F(12, 1, "Pass", "secret"), F(13, 1, "Email xác minh", "link", { link_tab: 2 }), F(21, 2, "Email"), F(22, 2, "Mật khẩu", "secret"),
    F(31, 3, "Họ tên"), F(32, 3, "Lương", "number"), F(33, 3, "Phòng ban", "select", { opts: "Kinh doanh,Kế toán,Kỹ thuật" }), F(34, 3, "Ngày vào làm", "date"),
    F(41, 4, "Tên sản phẩm"), F(42, 4, "Số lượng", "number"), F(43, 4, "Giá", "number"), F(44, 4, "Danh mục"),
    F(51, 5, "Tiêu đề"), F(52, 5, "Nội dung"), F(53, 5, "Lượt thích", "number"), F(54, 5, "Chủ đề"), F(55, 5, "Ngày đăng", "date"),
    F(61, 6, "Tên khách"), F(62, 6, "Nguồn"), F(63, 6, "SĐT"), F(64, 6, "Chi phí", "number")];
  const S = (id, tab_id, label, color) => ({ id, tab_id, label, color });
  const sts = [S(1, 1, "Live", "#10b981"), S(2, 1, "Die", "#ef4444"), S(3, 2, "Live", "#10b981"), S(4, 2, "Die", "#ef4444"), S(5, 3, "Đang làm", "#10b981"), S(6, 3, "Nghỉ việc", "#a1a1aa"),
    S(7, 4, "Còn hàng", "#10b981"), S(8, 4, "Hết hàng", "#ef4444"), S(9, 5, "Đã đăng", "#10b981"), S(10, 5, "Nháp", "#a1a1aa"), S(11, 6, "Mới", "#0ea5e9"), S(12, 6, "Đã chốt", "#10b981")];
  const depts = [{ id: 1, name: "Sale" }, { id: 2, name: "Ads" }];
  const owners = [{ id: 10, dept_id: 1, parent_id: null, name: "Nguyễn Văn Hải" }, { id: 11, dept_id: 1, parent_id: 10, name: "Trần Cường" }, { id: 12, dept_id: 1, parent_id: 10, name: "Lê Nam" }, { id: 20, dept_id: 2, parent_id: null, name: "Phạm Lan" }];
  const accs = [], links = [], own = [10, 11, 12, 20], T0 = 1767225600; let id = 100;
  const add = (tab, st, data, k) => accs.push({ id: ++id, tab_id: tab, dept_id: own[k % 4] === 20 ? 2 : 1, owner_id: own[k % 4], status_id: st, device_id: null, note: k % 5 === 0 ? "cần xác minh" : "", data, created: T0 + k * 86400 * 7, updated: T0 + k * 86400 * 7 });
  for (let k = 0; k < 20; k++) add(2, k % 4 ? 3 : 4, { 21: `mail${k}@gmail.com`, 22: `pw${k}x` }, k);
  for (let k = 0; k < 20; k++) { add(1, k % 3 ? 1 : 2, { 11: String(100000000 + k * 7), 12: k % 4 ? `pass${k}` : "" }, k); if (k % 2) links.push({ src: id, dst: 101 + k, field_id: 13 }); }
  const names = ["An", "Bình", "Chi", "Dũng", "Giang", "Hoa", "Khánh", "Linh", "Minh", "Ngọc", "Oanh", "Phúc", "Quân", "Sơn", "Tâm", "Uyên", "Vân", "Xuân", "Yến", "Đức"], pb = ["Kinh doanh", "Kế toán", "Kỹ thuật"];
  for (let k = 0; k < 20; k++) add(3, k % 6 ? 5 : 6, { 31: "Nguyễn " + names[k], 32: String(8000000 + k * 750000), 33: pb[k % 3], 34: `2025-${String(1 + (k % 12)).padStart(2, "0")}-15` }, k);
  const dm = ["Điện thoại", "Phụ kiện", "Laptop"], sp = ["iPhone 15", "Ốp lưng", "Macbook Air", "Samsung S24", "Tai nghe", "Dell XPS", "Xiaomi 14", "Sạc nhanh", "Asus Zenbook", "Oppo Reno"];
  for (let k = 0; k < 20; k++) add(4, k % 5 ? 7 : 8, { 41: sp[k % 10] + (k > 9 ? " Pro" : ""), 42: String((k * 3) % 17), 43: String(150000 + k * 1250000), 44: dm[k % 3] }, k);
  const cd = ["Du lịch", "Ẩm thực", "Công nghệ"], nd = ["Chuyến đi Đà Lạt mùa hoa dã quỳ thật tuyệt vời và đáng nhớ", "Món phở bò Hà Nội nóng hổi buổi sáng ngon khó cưỡng", "Đánh giá điện thoại mới ra mắt với camera cực đẹp và pin trâu", "Khuyến mãi freeship toàn quốc cho đơn hàng từ hôm nay đến cuối tuần"];
  for (let k = 0; k < 20; k++) add(5, k % 4 ? 9 : 10, { 51: "Bài số " + k, 52: nd[k % 4] + " #" + k, 53: String((k * 37) % 500), 54: cd[k % 3], 55: `2026-${String(1 + (k % 9)).padStart(2, "0")}-0${1 + (k % 9)}` }, k);
  const ng = ["Zalo", "Facebook", "Website"];
  for (let k = 0; k < 20; k++) add(6, k % 3 ? 11 : 12, { 61: "Khách " + names[k], 62: ng[k % 3], 63: "09" + String(10000000 + k * 13), 64: String(200000 + k * 50000) }, k);
  return { meta: { tabs, fields, sts, owners, depts }, accs, links };
}
const FX = fixture();
const PROF = R.buildProf(FX.meta.fields, FX.accs);
let VI = null;
const ENV = { prof: PROF, vidx: () => (VI ??= R.buildVidx(FX.accs)), alias: {} };
const brain = (ctx = {}) => new R.Brain(FX.meta, ENV, ctx);
/** đúng luồng tầng 2 của chat(): hint → understand → merge_hint */
function rules(text, ctx = {}) {
  const B = brain(ctx), [t2, hx] = H.hint(text, B);
  let pl = t2.trim() || !Object.keys(hx).length ? R.understand(t2, ctx, B) : { it: "search", spec: {}, rest: [] };
  if (["search", "count", "set", "del"].includes(pl.it)) pl = H.mergeHint(pl, hx, B, ctx, text);
  return pl;
}
/** query() của owl.ts: phạm vi tab/bộ phận/owner(+cấp dưới)/ids → evalSpec */
const CX = Q.mkCx(FX.meta); Q.cxAddLinks(CX, FX.links); const A = new Map(FX.accs.map((a) => [a.id, a])); for (const a of FX.accs) CX.atab.set(a.id, a.tab_id);
function query(sp) {
  let rows = FX.accs;
  if (sp.tab != null && sp.tab !== "all") rows = rows.filter((a) => a.tab_id === +sp.tab);
  if (sp.owner != null) { const ids = new Set(); for (const o of [].concat(sp.owner)) { if (sp.sub !== false) Q.descendants(+o, FX.meta.owners, ids); else ids.add(+o); } rows = rows.filter((a) => ids.has(a.owner_id)); }
  if (sp.ids) rows = rows.filter((a) => sp.ids.includes(a.id));
  return Q.evalSpec(sp, rows, CX, A, 12, { contentField: (t) => R.contentField(PROF, t), kindOf: (f) => R.fprofOf(PROF, f).kind }, FX.accs);
}
const has = (obj, part) => assert.deepEqual(Object.fromEntries(Object.keys(part).map((k) => [k, obj[k]])), part);

test("so khớp mờ giống difflib + viết tắt", () => {
  assert.equal(R.seqRatio("danh", "doanh").toFixed(4), "0.8889");
  assert.equal(R.seqRatio("facebok", "facebook").toFixed(4), "0.9333");
  assert.equal(R.seqRatio("khoan", "doanh"), 0.6);
  assert.ok(R.ab("fb", "facebook") && R.ab("qc", "quang cao") && !R.ab("danh", "dang khang"));
  assert.ok(R.wm("facebok", "facebook") && !R.wm("live", "life"));
});

test("học kiểu trường từ dữ liệu", () => {
  const k = (fid) => R.fprofOf(PROF, fid).kind;
  assert.equal(k(32), "num"); assert.equal(k(34), "date"); assert.equal(k(52), "long"); assert.equal(k(44), "cat"); assert.equal(k(33), "cat"); assert.equal(k(12), "secret");
  assert.equal(R.contentField(PROF, 5), 52);
});

test("câu nhiều lĩnh vực", () => {
  has(rules("bao nhiêu fb live").spec, { tab: 1, status: ["Live"] });
  assert.equal(rules("bao nhiêu fb live").it, "count");
  has(rules("fb live của Hải").spec, { tab: 1, status: ["Live"], owner: 10 });
  has(rules("fb chưa có email xác minh").spec, { tab: 1, where: [{ field: 13, op: "empty" }] });
  has(rules("lấy ra 5 fb live của Hải").spec, { tab: 1, status: ["Live"], owner: 10, limit: 5 });
  has(rules("pass dài hơn 6 ký tự").spec, { tab: 1, where: [{ field: 12, op: "len_gt", value: 6 }] });
  has(rules("nhân viên phòng kế toán").spec, { tab: 3, where: [{ field: 33, op: "in", value: ["Kế toán"] }] });
  has(rules("nhân sự lương từ 9 triệu đến 12 triệu").spec, { tab: 3, where: [{ field: 32, op: "num_between", value: [9000000, 12000000] }] });
  has(rules("kho hàng còn hàng danh mục laptop").spec, { tab: 4, status: ["Còn hàng"], where: [{ field: 44, op: "in", value: ["Laptop"] }] });
  has(rules("sản phẩm giá từ 1 triệu đến 5 triệu").spec, { tab: 4, where: [{ field: 43, op: "num_between", value: [1000000, 5000000] }] });
  has(rules("bài đăng nói về phở").spec, { tab: 5, where: [{ field: 52, op: "contains", value: "phở" }] });
  has(rules("bài đăng không có chữ phở").spec, { tab: 5, where: [{ field: 52, op: "not_contains", value: "phở" }] });
  has(rules("top 5 bài đăng nhiều lượt thích nhất").spec, { tab: 5, limit: 5, sort: { field: 53, dir: "desc" } });
  has(rules("bài đăng theo tháng").spec, { tab: 5, group: { by: 55, unit: "month", order: "desc" } });
  has(rules("bài đăng tháng 3").spec.where[0], { field: 55, op: "after" });
  has(rules("khách hàng đến từ zalo đã chốt").spec, { tab: 6, status: ["Đã chốt"], where: [{ field: 62, op: "in", value: ["Zalo"] }] });
  has(rules("đếm khách hàng theo nguồn").spec, { tab: 6, group: { by: 62 } });
  has(rules("owner nào nhiều fb nhất").spec, { tab: 1, group: { by: "owner", top: 1 } });
  has(rules("fb của Hải nhưng không phải live").spec, { tab: 1, owner: 10, where: [{ field: "status", op: "nin", value: ["Live"] }] });
});

test("bẫy bỏ dấu: lương / lượng", () => {
  has(rules("nhân sự lương trên 10 triệu").spec, { tab: 3, where: [{ field: 32, op: "num_gt", value: 10000000 }] });
  has(rules("số lượng sản phẩm dưới 5").spec, { tab: 4, where: [{ field: 42, op: "num_lt", value: 5 }] });
  has(rules("sản phẩm nào đắt nhất").spec, { tab: 4, sort: { field: 43, dir: "desc" }, limit: 1 }); // trường tiền là Giá, không phải "Số lượng"
  has(rules("sản phẩm rẻ nhất").spec, { tab: 4, sort: { field: 43, dir: "asc" } });
  has(rules("nhân viên lương thấp nhất").spec, { tab: 3, sort: { field: 32, dir: "asc" } });
  const B = brain(); assert.equal(R.money(B, 4).id, 43); assert.equal(R.money(B, 3).id, 32);
});

test("bẫy bỏ dấu: trùng / trung bình", () => {
  has(rules("uid bị trùng ở fb").spec, { tab: 1, dup: { field: 11, min: 2 } });
  has(rules("trùng sđt khách hàng").spec, { tab: 6, dup: { field: 63, min: 2 } });
  const avg = rules("lương trung bình theo phòng ban");
  has(avg.spec, { tab: 3, group: { by: 33 }, agg: { fn: "avg", field: 32 } }); assert.equal(avg.spec.dup, undefined);
  has(rules("chi phí trung bình theo nguồn").spec, { tab: 6, group: { by: 62 }, agg: { fn: "avg", field: 64 } });
});

test("bẫy bỏ dấu: mới / mỗi", () => {
  const each = rules("mỗi owner có bao nhiêu fb live");
  has(each.spec, { tab: 1, status: ["Live"], group: { by: "owner" } });
  assert.equal(R.signature("mỗi owner có bao nhiêu fb live", brain())[0], "moi owner co bao nhieu <t> <s>"); // "mỗi" không bị khớp sang tình trạng "Mới"
  has(rules("mỗi phòng ban có bao nhiêu nhân sự").spec, { tab: 3, group: { by: 33 } });
  has(rules("khách hàng mới").spec, { tab: 6, status: ["Mới"] });
  const fresh = rules("khách mới tạo"); has(fresh.spec, { tab: 6, sort: { field: "created", dir: "desc" } }); assert.equal(fresh.spec.status, undefined);
  assert.equal(rules("nhân sự vào làm tháng 5 năm 2025").spec.owner, undefined); // "năm" không phải owner "Lê Nam"
});

test("bẫy bỏ dấu: chi / chỉ (+ nháp / nhập) với câu nối tiếp", () => {
  const prev = { spec: { tab: 5 } };
  const only = rules("chỉ nháp", prev); assert.equal(only.it, "search"); assert.equal(only.ctx, true); has(only.spec, { tab: 5, status: ["Nháp"] });
  const cost = rules("chi phí trên 500 nghìn", prev); assert.notEqual(cost.ctx, true); has(cost.spec, { tab: 6, where: [{ field: 64, op: "num_gt", value: 500000 }] });
  const live = rules("chỉ live", { spec: { tab: 1, owner: 10 } }); has(live.spec, { tab: 1, owner: 10, status: ["Live"] }); assert.equal(live.spec.where, undefined);
  has(rules("tháng 3 thôi", prev).spec.where[0], { field: 55, op: "after" });
});

test("lệnh đổi / chuyển / giao / xoá / ghi chú / cập nhật / nhập", () => {
  const a = rules("đổi fb die của Cường sang live"); assert.equal(a.it, "set"); has(a.spec, { tab: 1, status: ["Die"], owner: 11 }); assert.deepEqual(a.ops, [{ op: "set_status", value: "Live" }]);
  const b = rules("chuyển toàn bộ fb của Hải cho Lan"); assert.equal(b.it, "set"); has(b.spec, { tab: 1, owner: 10, sub: false }); assert.deepEqual(b.ops, [{ op: "set_owner", value: 20 }]);
  const c = rules("giao khách hàng mới cho Nam"); has(c.spec, { tab: 6, status: ["Mới"] }); assert.deepEqual(c.ops, [{ op: "set_owner", value: 12 }]);
  const d = rules("xoá fb die"); assert.equal(d.it, "del"); has(d.spec, { tab: 1, status: ["Die"] });
  const e = rules("xoá khách hàng của Lan"); assert.equal(e.it, "del"); has(e.spec, { tab: 6, owner: 20 });
  const f = rules("đổi bài đăng nháp thành đã đăng"); has(f.spec, { tab: 5, status: ["Nháp"] }); assert.deepEqual(f.ops, [{ op: "set_status", value: "Đã đăng" }]);
  const g = rules("cập nhật pass 123456 cho uid: 100000007, 100000014"); has(g.spec, { tab: 1, where: [{ field: 11, op: "in", value: ["100000007", "100000014"] }] }); assert.deepEqual(g.ops, [{ op: "set_field", field: 12, value: "123456" }]);
  const h = rules("ghi chú cần kiểm tra cho fb die"); assert.deepEqual(h.ops, [{ op: "set_note", value: "kiểm tra", mode: "append" }]);
  const i = rules("xoá các dòng đang chọn", { selected: [121, 122] }); assert.equal(i.it, "del"); assert.deepEqual(i.spec.ids, [121, 122]);
  const j = rules("đổi sang die", { selected: [121] }); has(j.spec, { ids: [121] }); assert.deepEqual(j.ops, [{ op: "set_status", value: "Die" }]);
  const k = rules("nhập fb của Hải: 123456789|abc"); assert.equal(k.it, "add"); has(k.spec, { tab: 1, owner: 10 }); assert.deepEqual(k.rows, [{ 11: "123456789", 12: "abc" }]);
  assert.throws(() => rules("xoá"), R.Ask); // không nói rõ dòng nào → hỏi lại
});

test("kết quả truy vấn + xem trước sửa", () => {
  const live = FX.accs.filter((a) => a.tab_id === 1 && a.status_id === 1);
  assert.equal(query(rules("bao nhiêu fb live").spec).count, live.length);
  assert.equal(query(rules("fb live của Lê Nam").spec).count, live.filter((a) => a.owner_id === 12).length);
  assert.equal(query(rules("fb live của Hải").spec).count, live.filter((a) => [10, 11, 12].includes(a.owner_id)).length); // gồm cấp dưới
  assert.equal(query(rules("fb có email xác minh").spec).count, FX.links.length);
  const g = query(rules("đếm khách hàng theo nguồn").spec); assert.deepEqual(g.groups.map((x) => [x.k, x.n]).sort(), [["Facebook", 7], ["Website", 6], ["Zalo", 7]]);
  const avg = query(rules("lương trung bình theo phòng ban").spec); assert.equal(avg.groups.length, 3);
  const top = query(rules("bài đăng nhiều lượt thích nhất").spec); assert.equal(top.rows[0].lk.startsWith("Lượt thích: "), true);
  const pl = rules("đổi fb die của Cường sang live"), r = query(pl.spec);
  for (const a of r.all) { const p = Q.planAct(pl.ops[0], a, CX); assert.deepEqual([p.before, p.after, p.act[0]], ["Die", "Live", "status"]); }
});

test("mẫu đã học: chữ ký có chỗ trống dùng lại cho tab / tình trạng / owner khác", () => {
  const B = brain(), pl = rules("fb live của Hải"), [sig, slots] = R.signature("fb live của Hải", B), [tp, ok] = R.templ(pl, slots);
  assert.equal(sig, "<t> <s> cua <o>"); assert.ok(ok);
  const pat = { id: "p1", sig, plan: tp, hits: 0, ts: 0 };
  const [sig2, slots2] = R.signature("email die của Cường", B); assert.equal(sig2, sig);
  const r = R.fromPattern([pat], sig2, slots2, B, "email die của Cường"); has(r.pl.spec, { tab: 2, status: ["Die"], owner: 11 });
  const [sig3, slots3] = R.signature("kho hàng die của Lan", B); // tab Kho hàng không có tình trạng Die → không áp dụng, giữ mẫu
  assert.equal(R.fromPattern([pat], sig3, slots3, B, ""), null);
  assert.ok(R.junk({ spec: { where: [{ field: 11, op: "contains", value: "…" }] } }));
});

test("JSON của AI → plan đã kiểm chứng (tên → id, tên sai → hỏi lại)", () => {
  const B = brain();
  const p = R.fromJson({ do: "search", tab: "Facebook", status: ["Live"], owner: ["Hải"], where: [{ field: "Email xác minh", op: "any_link", value: { status: ["Die"] } }] }, B, {}, {});
  has(p.spec, { tab: 1, status: ["Live"], owner: 10 }); assert.deepEqual(p.spec.where, [{ field: 13, op: "any_link", value: { tab: 2, status: ["Die"] } }]);
  const s = R.fromJson({ do: "set", tab: "Kho hàng", where: [{ field: "Danh mục", op: "eq", value: "Laptop" }], ops: [{ op: "set_status", value: "Hết hàng" }] }, B, {}, {});
  assert.equal(s.it, "set"); assert.deepEqual(s.ops, [{ op: "set_status", value: "Hết hàng" }]);
  assert.throws(() => R.fromJson({ do: "search", tab: "Zzzz" }, B, {}, {}), R.Ask);
  assert.throws(() => R.fromJson({ do: "search", tab: "Facebook", where: [{ field: "UID", op: "eq", value: "select * from x where a=1" }] }, B, {}, {}), /SQL/);
  assert.deepEqual(R.parseJson('<think>…</think>```json\n{"do":"count"}\n```'), { do: "count" });
});

test("chip · tên kế hoạch · gợi ý", () => {
  const B = brain(), sp = rules("fb của Hải nhưng không phải live").spec;
  assert.deepEqual(R.chips(sp, B).map((c) => c.t), ["Facebook", "Nguyễn Văn Hải", "Tình trạng: không phải Live"]);
  assert.equal(R.condTxt({ field: 13, op: "empty" }, B), "Chưa có Email xác minh");
  assert.deepEqual(R.planNames(rules("chuyển toàn bộ fb của Hải cho Lan"), B).ops, [{ op: "set_owner", value: "Phạm Lan" }]);
  assert.equal(R.fmtn(1234567.5), "1.234.567,50");
  assert.ok(R.suggestions(B).length > 0);
  assert.ok(R.profileText(B).includes("Lương=số"));
});
