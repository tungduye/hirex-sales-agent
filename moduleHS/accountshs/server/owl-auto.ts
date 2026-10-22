import "server-only";

import { HsError, T, now, pages, run, sb } from "./db";
import { queuedNote } from "./checker";
import { enqueueOwl, owlEngine, owlHeal, owlTracked } from "./owl-run";
import type { Id } from "../types";

/* Cú vọ tự động (owl/) — thu thập dữ liệu ngoài (bài đăng Page…) rồi đồng bộ vào tab.
   Việc thu thập chạy ngay trong máy chủ Node (owl-run.ts → owl-job.ts → owl-postfb.ts, port 1:1 của worker/owl_postfb.py) qua ahs_jobs (kind 'owl');
   đặt AHS_OWL_ENGINE=python để quay lại cách cũ (chỉ xếp hàng, chờ worker Python).
   Next: boot (kịch bản + tab + owner), sources (giải cookie/nguồn), run (tạo job), job (đọc tiến trình),
   stop, sync (ghi kết quả vào tab — thuần DB, làm tại đây). Port của owl/owl.py (handle + sync_rows). */

const nzc = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Kịch bản owl hiện có (đồng bộ với owl/owl_postfb.py :: SCRIPT). Thêm kịch bản = thêm file worker + 1 mục ở đây. */
const SCRIPTS = [{
  id: "fb_page_group_posts", name: "Thu thập bài viết đã đăng lên page", platform: "Facebook", version: "1.1",
  desc: "Đọc Nhật ký hoạt động (bài đăng trong nhóm) của từng Page bằng cookie admin. Lọc theo số lượng và khoảng ngày giờ.",
  tabs: ["FB Page"],
  inputs: [
    { k: "cookie", label: "Cookie", match: ["Cookie admin page", "Cookie"], required: true, secret: true },
    { k: "uid", label: "UID Page", match: ["UID Page", "UID", "ID"], hint: "Trống = lấy từ cookie" },
    { k: "name", label: "Tên Page", match: ["Tên Page", "Tên", "Name"] },
  ],
  params: [
    { k: "n", label: "Số bài tối đa / page", type: "number", default: 25, min: 1, max: 5000 },
    { k: "from", label: "Từ", type: "datetime", default: "" },
    { k: "to", label: "Đến", type: "datetime", default: "" },
  ],
  defaults: { doc_id: "27478633398483911", delay: 3, page_gap: 4, raw: false },
  columns: [
    { k: "post_uid", label: "UID bài đăng", main: true, key: true }, { k: "content", label: "Nội dung bài đăng", main: true, wide: true },
    { k: "post_link", label: "Link bài đăng", type: "url", main: true }, { k: "time", label: "Thời gian", type: "datetime", main: true },
    { k: "group_id", label: "UID nhóm", main: true }, { k: "group_name", label: "Tên nhóm", main: true }, { k: "group_link", label: "Link nhóm", type: "url", main: true },
    { k: "page_uid", label: "UID page", main: true }, { k: "page_name", label: "Tên page", main: true }, { k: "profile_uid", label: "UID profile", main: true }, { k: "profile_name", label: "Tên profile", main: true },
  ],
  export: ["post_uid", "content", "post_link", "time", "group_id", "group_name", "group_link", "page_uid", "page_name", "profile_uid", "profile_name"],
  sync: {
    tab: "Bài đăng FB", key: "post_uid",
    map: {
      group_name: ["Tên nhóm", "Nhóm"], group_id: ["UID nhóm"], group_link: ["Link nhóm"], post_uid: ["UID bài đăng", "UID"], post_link: ["Link bài đăng", "Link"],
      content: ["Nội dung bài đăng", "Nội dung"], time: ["Thời gian đăng", "Thời gian"], page_name: ["Tên page", "Page"], page_uid: ["UID page"], profile_name: ["Tên profile", "Profile đăng", "Profile"], profile_uid: ["UID profile"],
    },
  },
}] as const;
type Script = (typeof SCRIPTS)[number];
const scriptOf = (id: unknown) => SCRIPTS.find((s) => s.id === id);

interface TabF { id: Id; name: string; icon: string; color: string; fields: Array<{ id: Id; label: string; type: string; opts: string; link_tab: Id | null }> }
async function metaTabs(): Promise<TabF[]> {
  const tabs = await run<{ id: Id; name: string; icon: string; color: string }[]>(sb().from(T.tabs).select("id,name,icon,color").order("pos").order("id"));
  const fields = await pages<{ id: Id; tab_id: Id; label: string; type: string; opts: string; link_tab: Id | null }>((a, b) => sb().from(T.fields).select("id,tab_id,label,type,opts,link_tab").order("pos").order("id").range(a, b));
  return tabs.map((t) => ({ ...t, fields: fields.filter((f) => f.tab_id === t.id).map((f) => ({ id: f.id, label: f.label, type: f.type, opts: f.opts, link_tab: f.link_tab })) }));
}
const tabByName = (tabs: TabF[], name: unknown) => tabs.find((t) => nzc(t.name) === nzc(name));
function fieldMatch(fields: TabF["fields"], labels: string[]) {
  const labs = labels.map(nzc);
  for (const w of labs) { const f = fields.find((x) => nzc(x.label) === w); if (f) return f; }
  for (const w of labs) { const f = fields.find((x) => nzc(x.label).startsWith(w)); if (f) return f; }
  return null;
}
type Plan = { mode: "field"; field: Id; label: string } | { mode: "link"; via: Id; target: Id; label: string };
function cookiePlan(tab: TabF, tabs: TabF[]): Plan[] {
  const plan: Plan[] = [];
  const own = fieldMatch(tab.fields, ["Cookie admin page", "Cookie", "Cookie admin"]);
  if (own && (own.type === "text" || own.type === "secret")) plan.push({ mode: "field", field: own.id, label: "Cột · " + own.label });
  for (const f of tab.fields) if (f.type === "link" && f.link_tab) {
    const tgt = tabs.find((t) => t.id === f.link_tab); const ck = tgt && fieldMatch(tgt.fields, ["Cookie"]);
    if (tgt && ck) plan.push({ mode: "link", via: f.id, target: ck.id, label: `Link · ${f.label} → ${tgt.name}.${ck.label}` });
  }
  return plan;
}
async function accById(aid: Id) { const r = await run<{ id: Id; tab_id: Id; data: Record<string, unknown> } | null>(sb().from(T.accounts).select("id,tab_id,data").eq("id", aid).maybeSingle()); return r; }
async function linksFrom(aid: Id, fid: Id) { const r = await pages<{ dst: Id }>((a, b) => sb().from(T.links).select("dst").eq("src", aid).eq("field_id", fid).order("id").range(a, b)); return r.map((x) => x.dst); }
async function resolveCookie(a: { id: Id; data: Record<string, unknown> }, item: Plan | null): Promise<string> {
  if (!item) return "";
  if (item.mode === "field") return String(a.data[String(item.field)] ?? "");
  for (const d of await linksFrom(a.id, item.via)) { const ad = await accById(d); if (ad) { const v = String(ad.data[String(item.target)] ?? ""); if (v) return v; } }
  return "";
}
/** label_of: giá trị cột đầu (pos,id) của tab — tab.fields đã nạp sẵn (metaTabs sắp theo pos,id) nên không cần truy vấn thêm. */
function labelOf(a: { id: Id; data: Record<string, unknown> }, tab: TabF) { const f = tab.fields[0]; const v = f ? String(a.data[String(f.id)] ?? "") : ""; return v || "#" + a.id; }
async function resolveSource(a: { id: Id; tab_id: Id; data: Record<string, unknown> }, tab: TabF, tabs: TabF[], script: Script, mapping: Record<string, { mode?: string; field?: number; via?: number; target?: number }> | undefined) {
  const src: Record<string, unknown> = { id: a.id, label: labelOf(a, tab) };
  const plan = cookiePlan(tab, tabs);
  for (const inp of script.inputs) {
    const k = inp.k; const ov = (mapping || {})[k] || {};
    if (k === "cookie") {
      let item: Plan | null = null;
      if (ov.mode === "field" && ov.field != null) item = { mode: "field", field: Number(ov.field), label: "" };
      else if (ov.mode === "link" && ov.via != null && ov.target != null) item = { mode: "link", via: Number(ov.via), target: Number(ov.target), label: "" };
      else for (const p of plan) if (await resolveCookie(a, p)) { item = p; break; }
      src.cookie = item ? await resolveCookie(a, item) : ""; src.cookie_via = (item && "label" in item ? item.label : "") || "";
    } else {
      const fid = ov.field ?? (fieldMatch(tab.fields, (("match" in inp ? inp.match : []) as string[]) || [])?.id);
      src[k] = fid ? String(a.data[String(fid)] ?? "") : "";
    }
  }
  return src;
}

/* ───────── đồng bộ kết quả vào tab (port sync_rows, thuần DB Postgres) ───────── */
async function ownerFn(spec: unknown, rows: Array<Record<string, unknown>>): Promise<((r: Record<string, unknown>) => [Id, Id | null] | null) | null> {
  const s = String(spec || "");
  if (s.startsWith("o:")) { const o = await run<{ id: Id; dept_id: Id } | null>(sb().from(T.owners).select("id,dept_id").eq("id", Number(s.slice(2))).maybeSingle()); return o ? () => [o.dept_id, o.id] : null; }
  if (s.startsWith("d:")) { const d = await run<{ id: Id } | null>(sb().from(T.depts).select("id").eq("id", Number(s.slice(2))).maybeSingle()); return d ? () => [d.id, null] : null; }
  if (s === "src") {
    const ids = [...new Set(rows.map((r) => Number(r._src)).filter((x) => Number.isInteger(x) && x > 0))];
    const m = new Map<Id, [Id, Id | null]>();
    for (let i = 0; i < ids.length; i += 500) { const ch = ids.slice(i, i + 500); for (const x of await run<{ id: Id; dept_id: Id; owner_id: Id | null }[]>(sb().from(T.accounts).select("id,dept_id,owner_id").in("id", ch))) m.set(x.id, [x.dept_id, x.owner_id]); }
    return (r) => { const v = Number(r._src); return Number.isInteger(v) ? m.get(v) ?? null : null; };
  }
  return null;
}
async function syncRows(script: Script, rows: Array<Record<string, unknown>>, tabName: unknown, mapping: Record<string, unknown> | undefined, key: unknown, owner: unknown) {
  const tabs = await metaTabs(); const tab = tabByName(tabs, tabName || script.sync.tab);
  if (!tab) throw new HsError("Không tìm thấy tab đích");
  const colmap: Record<string, Id> = {};
  const src = (mapping || script.sync.map) as Record<string, unknown>;
  for (const [ck, cand] of Object.entries(src)) {
    if (typeof cand === "number") colmap[ck] = cand;
    else { const f = fieldMatch(tab.fields, (Array.isArray(cand) ? cand : [String(cand)]) as string[]); if (f) colmap[ck] = f.id; }
  }
  const keycol = (key as string) || script.sync.key; const keyfid = colmap[keycol];
  const exist = new Map<string, Id>();
  if (keyfid) for (const r of await pages<{ id: Id; data: Record<string, unknown> }>((a, b) => sb().from(T.accounts).select("id,data").eq("tab_id", tab.id).order("id").range(a, b))) {   // đọc theo trang (max_rows 1000)
    const v = String(r.data[String(keyfid)] ?? "").trim().toLowerCase(); if (v) exist.set(v, r.id); }
  const dept = await run<{ id: Id } | null>(sb().from(T.depts).select("id").order("pos").order("id").limit(1).maybeSingle());
  const did = dept?.id ?? 1;
  const st = await run<{ id: Id } | null>(sb().from(T.statuses).select("id").eq("tab_id", tab.id).order("pos").order("id").limit(1).maybeSingle());
  const sid = st?.id ?? null; const ts = now();
  const own = await ownerFn(owner, rows);
  const res = { created: 0, updated: 0, dup: 0, skipped: 0, tab: tab.name };
  for (const row of rows) {
    const data: Record<string, string> = {};
    for (const [ck, fid] of Object.entries(colmap)) { const v = row[ck]; if (v !== "" && v !== null && v !== undefined) data[String(fid)] = String(v); }
    if (!Object.keys(data).length) { res.skipped++; continue; }
    const k = keycol ? String(row[keycol] ?? "").trim().toLowerCase() : "";
    const dw = own ? own(row) : null;
    if (k && exist.has(k)) {
      const aid = exist.get(k)!; const cur = await run<{ data: Record<string, unknown>; dept_id: Id; owner_id: Id | null } | null>(sb().from(T.accounts).select("data,dept_id,owner_id").eq("id", aid).maybeSingle());
      if (!cur) continue;
      const nw = { ...cur.data, ...data }; const chg = dw != null && (cur.dept_id !== dw[0] || cur.owner_id !== dw[1]);
      if (JSON.stringify(nw) === JSON.stringify(cur.data) && !chg) res.dup++;
      else { if (chg) await run(sb().from(T.accounts).update({ data: nw, dept_id: dw![0], owner_id: dw![1], updated: ts }).eq("id", aid)); else await run(sb().from(T.accounts).update({ data: nw, updated: ts }).eq("id", aid)); res.updated++; }
    } else {
      const r = await run<{ id: Id }>(sb().from(T.accounts).insert({ tab_id: tab.id, dept_id: dw ? dw[0] : did, owner_id: dw ? dw[1] : null, status_id: sid, note: "", data, created: ts, updated: ts }).select("id").single());
      if (k) exist.set(k, r.id); res.created++;
    }
  }
  return res;
}

/* ───────── job qua ahs_jobs (kind 'owl') ───────── */
async function apiRun(b: Record<string, unknown>) {
  const s = scriptOf(b.script); if (!s) throw new HsError("Kịch bản không tồn tại");
  const tabs = await metaTabs(); const tab = tabByName(tabs, b.tab) || tabByName(tabs, s.tabs[0]); if (!tab) throw new HsError("Không tìm thấy tab");
  const mapping = b.map as Record<string, { mode?: string; field?: number; via?: number; target?: number }> | undefined;
  const sources: Array<Record<string, unknown>> = [];
  for (const aid of (Array.isArray(b.ids) ? b.ids : []) as Id[]) { const a = await accById(aid); if (a && a.tab_id === tab.id) sources.push(await resolveSource(a, tab, tabs, s, mapping)); }
  if (!sources.length) throw new HsError("Không có nguồn hợp lệ");
  const payload = { script: s.id, defaults: s.defaults, sources, params: (b.params as Record<string, unknown>) || {} };
  const r = await run<{ id: Id }>(sb().from("ahs_jobs").insert({ kind: "owl", payload, status: "queued", progress: { status: "Chờ worker…", done: false, rows: [], logs: [] }, created: now(), by: "owl:" + s.id }).select("id").single());
  if (owlEngine() === "node") enqueueOwl(r.id);                                      // Node nhận việc ngay; worker Python (nếu có) không bao giờ chạy đôi
  return { job: String(r.id), n: sources.length };
}
async function apiJob(qs: URLSearchParams) {
  const id = Number(qs.get("id") || 0); if (!id) return { error: "job?" };
  let row = await run<{ status: string; by: string | null; progress: Record<string, unknown> } | null>(sb().from("ahs_jobs").select("status,by,progress").eq("id", id).maybeSingle());
  if (!row) return { error: "job?" };
  if (await owlHeal({ id, ...row })) row = (await run<typeof row>(sb().from("ahs_jobs").select("status,by,progress").eq("id", id).maybeSingle())) ?? row;
  const p = row.progress || {}; const rows = Array.isArray(p.rows) ? (p.rows as unknown[]) : []; const frm = Number(qs.get("from") || 0);
  const done = ["done", "failed", "stopped"].includes(row.status);
  const logs = Array.isArray(p.logs) ? [...(p.logs as unknown[])] : [];
  const note = owlTracked(id) ? "" : await queuedNote(row.status);                   // queued mà chưa có ai nhận → thêm 1 dòng nhật ký (không treo)
  if (note && !logs.some((l) => (l as { msg?: string }).msg === note)) logs.push({ t: "", msg: note, kind: "warn" });
  return { status: note ? "Chờ worker…" : String(p.status || row.status), done, paused: row.status === "paused", total: rows.length, rows: rows.slice(frm), logs };
}
async function apiStop(b: Record<string, unknown>) { await run(sb().from("ahs_jobs").update({ status: "stopped", finished: now() }).eq("id", Number(b.job || 0)).in("status", ["queued", "running", "paused"])); return { ok: 1 }; }
async function apiPause(b: Record<string, unknown>) { await run(sb().from("ahs_jobs").update({ status: b.on ? "paused" : "running" }).eq("id", Number(b.job || 0)).in("status", ["running", "paused"])); return { ok: 1 }; }
async function apiSources(b: Record<string, unknown>) {
  const s = scriptOf(b.script); if (!s) throw new HsError("Kịch bản không tồn tại");
  const tabs = await metaTabs(); const tab = tabByName(tabs, b.tab) || (s.tabs.length ? tabByName(tabs, s.tabs[0]) : undefined); if (!tab) throw new HsError("Không tìm thấy tab");
  const ids = (Array.isArray(b.ids) && b.ids.length ? b.ids : (await pages<{ id: Id }>((a, b) => sb().from(T.accounts).select("id").eq("tab_id", tab.id).order("id").range(a, b))).map((r) => r.id)) as Id[];
  const mapping = b.map as Record<string, { mode?: string; field?: number; via?: number; target?: number }> | undefined;
  const out: Array<Record<string, unknown>> = [];
  for (const aid of ids) { const a = await accById(aid); if (!a || a.tab_id !== tab.id) continue; const src = await resolveSource(a, tab, tabs, s, mapping); const ck = String(src.cookie || ""); out.push({ id: aid, label: src.label, uid: src.uid || "", name: src.name || "", cookie_ok: Boolean(ck), cookie_via: src.cookie_via || "" }); }
  return { tab: { id: tab.id, name: tab.name }, plan: cookiePlan(tab, tabs), fields: tab.fields, sources: out };
}
async function apiBoot() {
  const tabs = await metaTabs();
  return { scripts: SCRIPTS.map((s) => ({ ...s })), tabs, depts: await run(sb().from(T.depts).select("id,name,color").order("pos").order("id")), owners: await run(sb().from(T.owners).select("id,dept_id,parent_id,name,color").order("pos").order("id")) };
}

export async function owlAutoHandle(method: "GET" | "POST", path: string, qs: URLSearchParams, raw: Buffer | null): Promise<[unknown, number?]> {
  try {
    if (method === "GET") { if (path === "boot") return [await apiBoot()]; if (path === "job") return [await apiJob(qs)]; return [{ error: "not found" }, 404]; }
    const b = raw && raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    if (path === "sources") return [await apiSources(b)];
    if (path === "run") return [await apiRun(b)];
    if (path === "stop") return [await apiStop(b)];
    if (path === "pause") return [await apiPause(b)];
    if (path === "sync") { const s = scriptOf(b.script); if (!s) throw new HsError("Kịch bản không tồn tại"); return [await syncRows(s, (b.rows as Array<Record<string, unknown>>) || [], b.tab, b.map as Record<string, unknown> | undefined, b.key, b.owner)]; }
    return [{ error: "not found" }, 404];
  } catch (e) { if (e instanceof HsError) return [{ error: e.message }, e.status]; return [{ error: e instanceof Error ? e.message : String(e) }, 500]; }
}
