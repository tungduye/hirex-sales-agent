import "server-only";

import { HsError, T, bumpVer, log, now, orMissing, pages, run, sb, SRC } from "./db";
import { snapshot } from "./backup";
import { ALL_METAS, Abort, MOD_MAP, NODE_FALLBACK, WORKER_IDS, type CheckOut, type CheckerMeta, type CheckerMod } from "./checker-mods";
import type { Id } from "../types";

/* Vọng gác (checker/) — khung chạy trong HireX.
   · Checker thuần (Telegram / Gmail / Proxy) chạy NGAY trong tiến trình Node (server/checker-mods.ts).
   · Checker cần curl_cffi (FB / FB Page / Bài đăng FB) → tạo job trong ahs_jobs cho worker Python chạy,
     worker ghi kết quả thô vào ahs_jobs.result; Next đọc lại và ÁP DỤNG (_apply/_apply_x + ahs_cyv_checks).
   API giữ đúng core.py: GET /state · POST /cfg · /run · /stop. */

type Cfg = Record<string, unknown>;
const DEF: Cfg = { tab_id: null, field_id: null, target: "status", live: null, die: null, threads: 10, timeout: 10, proxy: "", url: "", x: {}, auto: false, every: 60, scope: "all", last: 0 };

const metaOf = (cid: string): CheckerMeta | undefined => ALL_METAS.find((m) => m.id === cid);
const nz = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();

/* ───────── worker Python: nhịp sống (dòng ahs_jobs kind='worker', worker cập nhật `started` vài giây/lần) ───────── */
const WORKER_TTL = 60;
/** Worker còn chạy không (nhịp gần nhất ≤ 60 giây). Dùng chung cho Vọng gác / CRM / Cú vọ tự động. */
export async function workerAlive(): Promise<boolean> {
  const r = await orMissing(run<{ started: number | null } | null>(sb().from("ahs_jobs").select("started").eq("kind", "worker").order("started", { ascending: false }).limit(1).maybeSingle()), () => null);
  return Boolean(r?.started && now() - Number(r.started) < WORKER_TTL);
}
/** Thông báo cho job còn 'queued' khi chưa có worker nhận (giao diện không treo im lặng). */
export async function queuedNote(status: string): Promise<string> {
  if (status !== "queued") return "";
  return (await workerAlive()) ? "" : "Chưa có worker chạy (worker/hs-accountshs-worker.py trên máy chủ) — việc đang chờ trong hàng đợi, sẽ chạy khi worker bật.";
}

/** 0h hôm nay theo giờ VN (UTC+7), epoch giây — không phụ thuộc tz máy chủ. */
function today0(): number { const off = 7 * 3600; const t = now() + off; return Math.floor(t / 86400) * 86400 - off; }

/* ───────── cấu hình (ahs_settings 'cyv.<id>') ───────── */
async function cfgGet(cid: string): Promise<Cfg> {
  const r = await run<{ v: string | null } | null>(sb().from(T.settings).select("v").eq("k", "cyv." + cid).maybeSingle());
  const c: Cfg = { ...DEF };
  const m = metaOf(cid);
  if (m) { c.threads = m.threads ?? c.threads; c.timeout = m.timeout ?? c.timeout; c.url = m.url ?? ""; }
  if (r?.v) { try { Object.assign(c, JSON.parse(r.v || "{}")); } catch { /* cfg hỏng: dùng mặc định */ } }
  return c;
}
async function cfgSet(cid: string, c: Cfg) { await run(sb().from(T.settings).upsert({ k: "cyv." + cid, v: JSON.stringify(c) }, { onConflict: "k" })); }

/* ───────── ghép giá trị nhiều cột (proxy) + chọn dòng cần check ───────── */
async function fieldsOf(tab: Id) { return pages<{ id: Id; label: string; type: string }>((a, b) => sb().from(T.fields).select("id,label,type").eq("tab_id", tab).order("pos").order("id").range(a, b)); }
async function partFields(cfg: Cfg, cid: string): Promise<Record<string, Id>> {
  const m = metaOf(cid); const out: Record<string, Id> = {};
  if (!m?.parts?.length || !cfg.tab_id) return out;
  const fs = await fieldsOf(Number(cfg.tab_id));
  for (const p of m.parts) {
    const v = cfg["pf_" + p.k]; if (v === "") continue;
    let fid: Id | null = null;
    if (v !== null && v !== undefined && v !== "auto") { const n = Number(v); if (fs.some((f) => f.id === n)) fid = n; }
    if (fid == null) { const hints = [nz(p.label), ...(p.match || []).map(nz)]; fid = fs.find((f) => hints.includes(nz(f.label)) && f.id !== cfg.field_id)?.id ?? null; }
    if (fid != null) out[p.k] = fid;
  }
  return out;
}
async function targets(cfg: Cfg, ids: Id[] | null, onlyUnchecked: boolean, cid: string): Promise<Array<{ id: Id; value: string }>> {
  if (!cfg.tab_id || !cfg.field_id) return [];
  const m = MOD_MAP[cid]; const pf = Object.keys(await partFields(cfg, cid)).length ? await partFields(cfg, cid) : {};
  const comp = m?.compose && Object.keys(pf).length ? m.compose : null;
  const rows = await pages<{ id: Id; data: Record<string, unknown> }>((a, b) => sb().from(T.accounts).select("id,data").eq("tab_id", Number(cfg.tab_id)).order("id").range(a, b));   // đọc theo trang (max_rows 1000)
  const want = ids ? new Set(ids) : null;
  let done = new Set<Id>();
  if (onlyUnchecked) { const dr = await pages<{ acc_id: Id }>((a, b) => sb().from(T.cyv_checks).select("acc_id").eq("ck", cid).gte("ts", today0()).order("id").range(a, b)); done = new Set(dr.map((r) => r.acc_id)); }
  const out: Array<{ id: Id; value: string }> = [];
  for (const r of rows) {
    if (want && !want.has(r.id)) continue; if (done.has(r.id)) continue;
    const d = (r.data || {}) as Record<string, unknown>; const v = d[String(cfg.field_id)];
    if (typeof v === "string" && v.trim()) {
      let s = v.trim();
      if (comp) { try { s = comp(s, Object.fromEntries(Object.entries(pf).map(([k, fid]) => [k, String(d[String(fid)] ?? "")]))) || s; } catch { /* bỏ */ } }
      out.push({ id: r.id, value: s });
    }
  }
  return out;
}

/* ───────── ghi kết quả (_apply / _apply_x) ───────── */
async function xfield(cid: string, cfg: Cfg, ex: { k: string; label: string; type?: string; match?: string[] }): Promise<Id | null> {
  const tab = cfg.tab_id ? Number(cfg.tab_id) : null; const v = cfg["xf_" + ex.k];
  if (v === "" || !tab) return null;
  const fs = await fieldsOf(tab);
  if (v !== null && v !== undefined && v !== "auto") { const n = Number(v); if (fs.some((f) => f.id === n)) return n; }
  const hints = [nz(ex.label), ...(ex.match || []).map(nz)];
  const hit = fs.find((f) => hints.includes(nz(f.label)));
  let fid: Id;
  if (hit) fid = hit.id;
  else {
    const mp = await run<{ pos: number } | null>(sb().from(T.fields).select("pos").eq("tab_id", tab).order("pos", { ascending: false }).limit(1).maybeSingle());
    const r = await run<{ id: Id }>(sb().from(T.fields).insert({ tab_id: tab, label: ex.label, type: ex.type || "text", opts: "", pos: (mp?.pos ?? 0) + 1 }).select("id").single());
    fid = r.id;
  }
  cfg["xf_" + ex.k] = fid; await cfgSet(cid, cfg);
  return fid;
}
/* ───────── toàn vẹn dữ liệu khi Vọng gác ghi ─────────
   Cấu hình cũ có thể trỏ tới trạng thái / cột đã xoá hoặc của tab khác (vd Gmail "Không tồn tại" → trạng thái đã xoá). Trước đây vẫn ghi
   status_id đó vào dòng → dòng mang trạng thái "ma", Tổng quan / tự khớp sở hữu đếm sai. Giờ:
   · chạy: thiếu tab / cột giá trị / trạng thái Live-Die hợp lệ → dừng ngay, báo rõ thiếu gì; kết quả phụ (verify_phone…) trỏ sai → bỏ qua kết quả đó;
   · ghi: chỉ ghi trạng thái thuộc đúng tab, chỉ ghi vào dòng của đúng tab đang check. */
const RES_KEYS = ["live", "die", "verify_phone", "not_exist"];
const RES_LAB: Record<string, string> = { live: "Live", die: "Die", verify_phone: "Cần xác minh SĐT", not_exist: "Không tồn tại" };
const TST = new Map<Id, { at: number; st: Set<Id>; fs: Set<Id> }>();
async function tabMeta(tab: Id) {
  const h = TST.get(tab); if (h && Date.now() - h.at < 30_000) return h;
  const [st, fs] = await Promise.all([
    run<{ id: Id }[]>(sb().from(T.statuses).select("id").eq("tab_id", tab)),
    run<{ id: Id }[]>(sb().from(T.fields).select("id").eq("tab_id", tab)),
  ]);
  const x = { at: Date.now(), st: new Set(st.map((r) => r.id)), fs: new Set(fs.map((r) => r.id)) }; TST.set(tab, x); return x;
}
/** vấn đề của cấu hình: fatal = không chạy được, warn = kết quả phụ sẽ bị bỏ qua */
async function cfgIssues(cid: string, c: Cfg): Promise<{ fatal: string[]; warn: string[] }> {
  const fatal: string[] = [], warn: string[] = [], meta = metaOf(cid);
  const tab = Number(c.tab_id); if (!tab) return { fatal: ["Chưa chọn tab"], warn };
  const t = await run<{ id: Id } | null>(sb().from(T.tabs).select("id").eq("id", tab).maybeSingle());
  if (!t) return { fatal: ["tab đã bị xoá"], warn };
  const m = await tabMeta(tab);
  if (!c.field_id || !m.fs.has(Number(c.field_id))) fatal.push(`cột ${meta?.value || "giá trị"} không còn trong tab`);
  if ((c.target ?? "status") === "status") {
    const keys = [...new Set([...RES_KEYS, ...(meta?.results || []).map((r) => r[0])])];
    for (const k of keys) {
      const v = c[k]; if (v === null || v === undefined || v === "") continue;
      const lab = (meta?.results || []).find((r) => r[0] === k)?.[1] || RES_LAB[k] || k;
      if (!m.st.has(Number(v))) (k === "live" || k === "die" ? fatal : warn).push(`trạng thái ghi khi "${lab}" đã bị xoá / không thuộc tab`);
    }
  } else if (!m.fs.has(Number(c.target))) fatal.push("cột ghi kết quả không còn trong tab");
  return { fatal, warn };
}
/** Vọng gác vừa đổi trạng thái → tự khớp sở hữu kéo theo bao nhiêu dòng (nhật ký ahs_own_log, nguồn vonggac) */
async function ownImpact(since: number): Promise<number> {
  if (!since) return 0;
  try { const { count } = await sb().from("ahs_own_log").select("id", { count: "exact", head: true }).eq("src", "match").eq("origin", "vonggac").gte("ts", since); return count || 0; } catch { return 0; }
}
async function applyRes(cfg: Cfg, aid: Id, res: string, ts: number): Promise<boolean> {
  const val = cfg[res]; if (res === "error" || val === null || val === undefined || val === "") return false;
  const tab = Number(cfg.tab_id), tm = await tabMeta(tab);
  if ((cfg.target ?? "status") === "status") {
    if (!tm.st.has(Number(val))) return false;                                       // trạng thái đích không thuộc tab → không ghi
    const r = await run<{ status_id: Id | null } | null>(sb().from(T.accounts).select("status_id").eq("id", aid).eq("tab_id", tab).maybeSingle());
    if (r && r.status_id !== Number(val)) { await run(sb().from(T.accounts).update({ status_id: Number(val), updated: ts }).eq("id", aid).eq("tab_id", tab)); return true; }
    return false;
  }
  const fid = String(cfg.target); if (!tm.fs.has(Number(fid))) return false;
  const r = await run<{ data: Record<string, unknown> } | null>(sb().from(T.accounts).select("data").eq("id", aid).eq("tab_id", tab).maybeSingle());
  if (!r) return false; const d = { ...(r.data || {}) }; if (d[fid] === val) return false;
  d[fid] = val; await run(sb().from(T.accounts).update({ data: d, updated: ts }).eq("id", aid)); return true;
}
async function applyExtra(aid: Id, extra: Record<string, unknown> | undefined, ts: number, xf: Record<string, Id | null>): Promise<boolean> {
  if (!extra || !Object.keys(xf).length) return false;
  const r = await run<{ data: Record<string, unknown> } | null>(sb().from(T.accounts).select("data").eq("id", aid).maybeSingle());
  if (!r) return false; const d = { ...(r.data || {}) }; let ch = false;
  for (const [k, fid] of Object.entries(xf)) if (fid && extra[k] !== null && extra[k] !== undefined && d[String(fid)] !== String(extra[k])) { d[String(fid)] = String(extra[k]); ch = true; }
  if (ch) await run(sb().from(T.accounts).update({ data: d, updated: ts }).eq("id", aid));
  return ch;
}
/** áp 1 kết quả: ghi lịch sử cyv_checks + cập nhật trạng thái/cột. Trả về có đổi dữ liệu không. */
async function applyOne(cid: string, cfg: Cfg, xf: Record<string, Id | null>, out: { id: Id; res: string; info: string; extra?: Record<string, unknown> }): Promise<boolean> {
  return SRC.run({ src: "vonggac", name: "Vọng gác" }, () => applyOneNow(cid, cfg, xf, out));   // nhật ký sở hữu: đổi trạng thái do Vọng gác
}
async function applyOneNow(cid: string, cfg: Cfg, xf: Record<string, Id | null>, out: { id: Id; res: string; info: string; extra?: Record<string, unknown> }): Promise<boolean> {
  const ts = now();
  await run(sb().from(T.cyv_checks).insert({ ck: cid, acc_id: out.id, ts, res: out.res, info: String(out.info || "").slice(0, 120) }));
  const a1 = await applyRes(cfg, out.id, out.res, ts); const a2 = await applyExtra(out.id, out.extra, ts, xf);
  return a1 || a2;
}

/* ───────── job trong tiến trình (checker thuần) ───────── */
interface NodeJob { cid: string; running: boolean; stop: boolean; total: number; done: number; live: number; die: number; error: number; changed: number; started: number; ended: number; by: string; recent: Array<Record<string, unknown>>; scope: string; err_msg?: string }
const JOBS = new Map<string, NodeJob>();

async function runNodeJob(cid: string, cfg: Cfg, items: Array<{ id: Id; value: string }>, mod?: CheckerMod) {
  const m = mod ?? MOD_MAP[cid], meta = m.CHECKER, J = JOBS.get(cid)!;
  const xon = (meta.extra || []).filter((e) => cfg["xf_" + e.k] !== "").map((e) => e.k);
  const opt = { timeout: Number(cfg.timeout) || 10, proxy: String(cfg.proxy || ""), url: String(cfg.url || meta.url || ""), x: (cfg.x as Record<string, string>) || {}, xon, stopped: () => J.stop };
  const xf: Record<string, Id | null> = {};
  for (const e of meta.extra || []) if (xon.includes(e.k)) { try { xf[e.k] = await xfield(cid, cfg, e); } catch { xf[e.k] = null; } }
  const threads = Math.max(1, Math.min(Number(cfg.threads) || 10, 64));
  try {
    if (m.check_batch) {
      const bs = meta.batch || items.length || 1;
      for (let i = 0; i < items.length && !J.stop; i += bs) {
        const chunk = items.slice(i, i + bs);
        let rs: CheckOut[];
        try { rs = await m.check_batch(chunk.map((c) => c.value), opt); }
        catch (e) { if (e instanceof Error && e.name === "Abort") { J.stop = true; J.err_msg = e.message; break; } rs = chunk.map(() => ({ res: "error", info: e instanceof Error ? e.message.slice(0, 80) : "err" })); }
        for (let k = 0; k < chunk.length; k++) await consume(cid, cfg, xf, J, m, chunk[k], rs[k]);
      }
    } else if (m.check) {
      let i = 0;
      const workers = Array.from({ length: Math.min(threads, items.length) }, async () => {
        for (;;) { if (J.stop) return; const idx = i++; if (idx >= items.length) return; const it = items[idx];
          let r: CheckOut; const t0 = Date.now();
          try { r = await m.check!(it.value, opt); } catch (e) { r = { res: "error", info: e instanceof Error ? e.message.slice(0, 80) : "err" }; }
          // Die kéo theo tự khớp sở hữu (có thể hạ cả chuỗi xuống Mất) → kiểm lại 1 lần sau 1,5 giây cho chắc; lần 2 không Die thì không ghi Die
          if (r.res === "die" && !J.stop) {
            await new Promise((ok) => setTimeout(ok, 1500));
            let r2: CheckOut; try { r2 = await m.check!(it.value, opt); } catch (e) { r2 = { res: "error", info: e instanceof Error ? e.message.slice(0, 80) : "err" }; }
            r = r2.res === "die" ? { ...r, info: r.info + " · đã kiểm 2 lần" } : r2.res === "live" ? r2 : { res: "error", info: "Die chưa chắc (lần 2: " + r2.info + ") — giữ nguyên trạng thái" };
          }
          await consume(cid, cfg, xf, J, m, it, r, Date.now() - t0);
        }
      });
      await Promise.all(workers);
    }
  } catch (e) { J.err_msg = e instanceof Error ? e.message : String(e); }
  finally {
    J.running = false; J.ended = now();
    const c2 = await cfgGet(cid); c2.last = J.ended;
    try { const mt = m.meta?.(); if (mt && mt.credit != null) c2.credit = mt.credit; } catch { /* */ }
    await cfgSet(cid, c2);
    if (J.changed) await bumpVer();
    const oi = J.changed ? await ownImpact(J.started) : 0;
    await log("cyv_" + cid, J.done, `Vọng gác ${meta.name}: ${J.live} live · ${J.die} die · ${J.error} lỗi · đổi ${J.changed}${oi ? ` · sở hữu đổi theo ${oi}` : ""}${J.by === "auto" ? " (định kỳ)" : ""}`).catch(() => undefined);
  }
}
async function consume(cid: string, cfg: Cfg, xf: Record<string, Id | null>, J: NodeJob, m: CheckerMod, it: { id: Id; value: string }, r: CheckOut, ms = 0) {
  if (J.stop) return;
  J.done++; J[r.res as "live" | "die" | "error"] = (J[r.res as "live" | "die" | "error"] || 0) + 1;
  J.recent.unshift({ id: it.id, v: m.show ? m.show(it.value) : it.value, res: r.res, info: r.info, ms, ts: now() }); J.recent.length = Math.min(J.recent.length, 60);
  try { if (await applyOne(cid, cfg, xf, { id: it.id, res: r.res, info: r.info, extra: r.extra })) { J.changed++; await bumpSoon(); } } catch { /* lỗi ghi 1 dòng: bỏ qua */ }
}
/** ahs_ver + 1 khi có dòng đổi (để client/Cú vọ thấy), tối đa 1 lần / 3 giây trong lúc chạy */
let lastBump = 0;
async function bumpSoon() { if (Date.now() - lastBump > 3000) { lastBump = Date.now(); await bumpVer(); } }

/* ───────── job cho worker (curl_cffi) ───────── */
async function createWorkerJob(cid: string, cfg: Cfg, items: Array<{ id: Id; value: string }>) {
  const meta = metaOf(cid)!; const xon = (meta.extra || []).filter((e) => cfg["xf_" + e.k] !== "").map((e) => e.k);
  const have = await preloadExtra(cid, cfg, meta, xon, items.map((i) => i.id));   // số liệu thêm skip_filled: đọc ô đã có + dọn rác (_preload_extra)
  const payloadItems = items.map((i) => (have[i.id] ? { ...i, have: have[i.id] } : i));
  const payload = { cid, items: payloadItems, opt: { timeout: Number(cfg.timeout) || 12, proxy: String(cfg.proxy || ""), url: String(cfg.url || meta.url || ""), x: cfg.x || {}, xon } };
  await run(sb().from("ahs_jobs").insert({ kind: "cyv", payload, status: "queued", progress: { done: 0, total: items.length, applied: 0 }, created: now(), by: "cyv:" + cid }));
}
/** _preload_extra của core.py: cột skip_filled → đọc sẵn giá trị đang có (checker bỏ qua dòng đã đủ) + dọn giá trị rác (junk→'') cả tab; giá trị 'stale' giữ nguyên nhưng buộc đọc lại (trả ''). */
async function preloadExtra(cid: string, cfg: Cfg, meta: CheckerMeta, xon: string[], aids: Id[]): Promise<Record<number, Record<string, string>>> {
  const exs = (meta.extra || []).filter((e) => e.skip_filled && xon.includes(e.k));
  if (!exs.length || !cfg.tab_id) return {};
  const fids: Array<[string, string, RegExp | null, RegExp | null]> = [];
  for (const e of exs) { const f = await xfield(cid, cfg, e); if (f) fids.push([e.k, String(f), e.junk ? new RegExp(e.junk, "i") : null, e.stale ? new RegExp(e.stale) : null]); }
  if (!fids.length) return {};
  const want = new Set(aids); const out: Record<number, Record<string, string>> = {};
  const ts = now();
  for (const r of await pages<{ id: Id; data: Record<string, unknown> }>((a, b) => sb().from(T.accounts).select("id,data").eq("tab_id", Number(cfg.tab_id)).order("id").range(a, b))) {
    const d = { ...(r.data || {}) }; let ch = false;
    for (const [k, fid, jr, sr] of fids) {
      let v = String(d[fid] ?? "");
      if (v && jr && jr.test(v)) { d[fid] = ""; v = ""; ch = true; }
      if (want.has(r.id)) (out[r.id] ??= {})[k] = v && sr && sr.test(v) ? "" : v;
    }
    if (ch) await run(sb().from(T.accounts).update({ data: d, updated: ts }).eq("id", r.id));
  }
  return out;
}
async function activeWorkerJob(cid: string) {
  return orMissing(run<{ id: Id; status: string; progress: Record<string, unknown>; result: unknown; started: number | null; finished: number | null } | null>(
    sb().from("ahs_jobs").select("id,status,progress,result,started,finished").eq("kind", "cyv").eq("payload->>cid", cid).order("id", { ascending: false }).limit(1).maybeSingle()), () => null);
}
/** việc giao worker đang "chờ" nhưng không có worker nào sống → huỷ (giao diện không treo "đang chạy" mãi) */
async function dropStaleWorkerJobs(cid: string, minAge = 0) {
  const rows = await orMissing(run<{ id: Id; started: number | null }[]>(sb().from("ahs_jobs").select("id,started").eq("kind", "cyv").eq("payload->>cid", cid).eq("status", "queued")), () => []);
  const ids = rows.filter((r) => now() - Number(r.started || 0) >= minAge).map((r) => r.id);
  if (ids.length) await run(sb().from("ahs_jobs").update({ status: "stopped", finished: now(), progress: { err: "Không có worker nhận việc — đã huỷ" } }).in("id", ids)).catch(() => undefined);
}
/** đọc kết quả thô worker đã ghi và ÁP DỤNG những dòng chưa áp (applied = con trỏ trong progress). */
async function drainWorkerJob(cid: string): Promise<NodeJob | null> {
  let row = await activeWorkerJob(cid); if (!row) return null;
  if (row.status === "queued" && now() - Number(row.started || 0) > 120 && !(await workerAlive())) { await dropStaleWorkerJobs(cid, 120); row = await activeWorkerJob(cid); if (!row) return null; }
  const res = Array.isArray(row.result) ? (row.result as Array<{ id: Id; res: string; info: string; extra?: Record<string, unknown> }>) : [];
  const prog = (row.progress || {}) as Record<string, unknown>; const applied = Number(prog.applied || 0);
  const running = row.status === "queued" || row.status === "running";
  const J: NodeJob = { cid, running, stop: false, total: Number(prog.total || 0), done: Number(prog.done || res.length), live: 0, die: 0, error: 0, changed: 0, started: row.started || 0, ended: row.finished || 0, by: "worker", recent: [], scope: "" };
  for (const r of res) J[r.res as "live" | "die" | "error"] = (J[r.res as "live" | "die" | "error"] || 0) + 1;
  if (res.length > applied) {
    const cfg = await cfgGet(cid); const meta = metaOf(cid)!; const xf: Record<string, Id | null> = {};
    for (const e of meta.extra || []) if (cfg["xf_" + e.k] !== "") { try { xf[e.k] = await xfield(cid, cfg, e); } catch { xf[e.k] = null; } }
    for (let k = applied; k < res.length; k++) { try { if (await applyOne(cid, cfg, xf, res[k])) J.changed++; } catch { /* lỗi ghi 1 dòng: bỏ qua */ } }
    if (J.changed) await bumpVer();
    await run(sb().from("ahs_jobs").update({ progress: { ...prog, applied: res.length } }).eq("id", row.id));
    if (!running) { cfg.last = now(); await cfgSet(cid, cfg); }
  }
  if (!running && !prog.logged) {                                                  // ghi nhật ký 1 lần khi worker xong (như finally của core._run)
    const oi = await ownImpact(Number(row.started) || 0);
    await log("cyv_" + cid, J.done, `Vọng gác ${metaOf(cid)!.name}: ${J.live} live · ${J.die} die · ${J.error} lỗi · đổi ${J.changed}${oi ? ` · sở hữu đổi theo ${oi}` : ""}`).catch(() => undefined);
    await run(sb().from("ahs_jobs").update({ progress: { ...prog, applied: res.length, logged: 1 } }).eq("id", row.id)).catch(() => undefined);
  }
  if (row.status === "failed") J.err_msg = String(prog.err || "Worker lỗi");
  else if (running) { const note = await queuedNote(row.status); if (note) J.err_msg = note; }   // chưa có worker → báo, không treo im lặng
  J.recent = res.slice(-60).reverse().map((r) => ({ id: r.id, v: "", res: r.res, info: r.info, ts: 0 }));
  return J;
}

/* ───────── API ───────── */
/* Vọng gác được hỏi trạng thái liên tục (mỗi trình duyệt 30 giây/lần, đang chạy 1 giây/lần, kể cả trang HireX đang chạy nền) —
   mỗi lần đọc cấu hình + đếm thống kê của ~6 bộ check trên toàn bảng → nhiều người mở là máy chủ nghẽn (request 10–30 giây).
   Giờ: thống kê nhớ 20 giây / bộ check; cả trạng thái dùng chung cho mọi người (đang chạy: 0,8 giây, nghỉ: 3 giây); lưu cấu hình / chạy / dừng → tính lại ngay. */
const STATS = new Map<string, { at: number; p: Promise<{ total: number; today: number; live: number; die: number; error: number; runs_today: number }> }>();
let STATE: { at: number; p: Promise<{ checkers: unknown[]; now: number }> } | null = null;
function stateReset() { STATE = null; STATS.clear(); }
async function stateCached() {
  const t = Date.now(), ttl = [...JOBS.values()].some((j) => j.running) ? 800 : 3000;
  if (STATE && t - STATE.at < ttl) return STATE.p;
  const p = state(); STATE = { at: t, p }; p.catch(() => { STATE = null; });
  return p;
}
async function stats(cid: string) {
  const hit = STATS.get(cid);
  if (hit && Date.now() - hit.at < 20_000) return hit.p;
  const p = statsNow(cid); STATS.set(cid, { at: Date.now(), p }); p.catch(() => STATS.delete(cid));
  return p;
}
async function statsNow(cid: string) {
  const c = await cfgGet(cid);
  const s = await orMissing(run<{ total: number; today: number; live: number; die: number; error: number; runs_today: number }>(sb().rpc("ahs_cyv_stats", { p_ck: cid, p_tab: c.tab_id ?? null, p_fid: c.field_id ?? null, p_today: today0() })),
    () => ({ total: 0, today: 0, live: 0, die: 0, error: 0, runs_today: 0 }));
  return s;
}
async function state() {
  // các checker độc lập → đọc song song (tuần tự mỗi lần poll mất vài giây trên Supabase thật)
  const out = await Promise.all(ALL_METAS.map(async (meta) => {
    const cid = meta.id; const c = await cfgGet(cid);
    // FB / FB Page có thể chạy trong máy chủ (không có worker) → lượt mới nhất (máy chủ hoặc worker) là lượt hiển thị
    const nj = JOBS.get(cid) || null, wj = WORKER_IDS.has(cid) ? await drainWorkerJob(cid) : null;
    const J: NodeJob | null = nj && (!wj || nj.running || nj.started >= (wj.started || 0)) ? nj : wj ?? nj;
    const nxt = c.auto ? Number(c.last || 0) + Math.max(5, Number(c.every) || 60) * 60 : 0;
    const m = MOD_MAP[cid]; let mt: Record<string, unknown> = {}; try { mt = m?.meta?.() || {}; } catch { mt = {}; }
    if (mt.credit == null && c.credit != null) mt.credit = c.credit;
    const job = J ? { running: J.running, total: J.total, done: J.done, live: J.live, die: J.die, error: J.error, changed: J.changed, started: J.started, ended: J.ended, recent: J.recent, err_msg: J.err_msg } : {};
    // cấu hình trỏ tới cột / trạng thái đã xoá → hiện ngay trong khung checker (ô báo lỗi sẵn có của giao diện), không đợi lúc chạy
    const iss = c.tab_id ? await cfgIssues(cid, c).catch(() => null) : null, warn = iss ? [...iss.fatal, ...iss.warn] : [];
    const job2 = warn.length && !(J && J.running) && !(job as { err_msg?: string }).err_msg ? { ...job, err_msg: "Cần chọn lại: " + warn.join(" · ") } : job;
    return { id: cid, info: { ...meta }, cfg: c, stats: await stats(cid), meta: mt, job: job2, next: nxt, issues: warn };
  }));
  return { checkers: out, now: now() };
}
async function start(cid: string, ids: Id[] | null, scope?: string) {
  const meta = metaOf(cid); if (!meta) throw new HsError("Checker không tồn tại");
  const node = JOBS.get(cid); if (node?.running) throw new HsError("Đang chạy - chờ xong hoặc bấm Dừng");
  // Facebook / FB Page / Bài đăng FB: có worker Python đang sống → giao worker (đọc được cả tên); chưa có worker → FB / FB Page chạy
  // ngay trong máy chủ (Graph, chỉ Live / Die), Bài đăng FB báo rõ cần worker — không còn tạo việc "đang chờ" mãi không ai làm.
  const alive = WORKER_IDS.has(cid) ? await workerAlive() : false;
  if (WORKER_IDS.has(cid) && alive) { const w = await activeWorkerJob(cid); if (w && (w.status === "queued" || w.status === "running")) throw new HsError("Đang chạy - chờ xong hoặc bấm Dừng"); }
  if (WORKER_IDS.has(cid) && !alive) {
    await dropStaleWorkerJobs(cid);
    if (!NODE_FALLBACK[cid]) throw new HsError(`${meta.name} cần worker Python (đọc trang như trình duyệt) — worker chưa chạy trên máy chủ. Bật worker (worker/hs-accountshs-worker.py) rồi chạy lại.`);
  }
  const c = await cfgGet(cid);
  if (!c.tab_id || !c.field_id) throw new HsError("Chưa chọn tab và trường " + (meta.value || "giá trị"));
  if ((c.live === null || c.live === "") && (c.die === null || c.die === "")) throw new HsError("Chưa chọn giá trị ghi khi Live / Die");
  const iss = await cfgIssues(cid, c);
  if (iss.fatal.length) throw new HsError(`Vọng gác ${meta.name} — cần chọn lại: ${iss.fatal.join(" · ")}`);
  const sc = scope || String(c.scope || "all");
  const items = await targets(c, sc === "selected" ? ids : null, sc === "unchecked", cid);
  if (!items.length) throw new HsError("Không có dòng nào cần check");
  if (items.length > 50) await snapshot().catch(() => undefined);                  // core.start(): chụp bản an toàn trước lượt lớn
  if (WORKER_IDS.has(cid) && alive) { await createWorkerJob(cid, c, items); return { ok: 1, total: items.length }; }
  const J: NodeJob = { cid, running: true, stop: false, total: items.length, done: 0, live: 0, die: 0, error: 0, changed: 0, started: now(), ended: 0, by: "manual", recent: [], scope: sc };
  JOBS.set(cid, J);
  void runNodeJob(cid, c, items, WORKER_IDS.has(cid) ? NODE_FALLBACK[cid] : undefined);
  return { ok: 1, total: items.length, mode: WORKER_IDS.has(cid) ? "server" : "node" };
}
async function stop(cid: string) {
  const J = JOBS.get(cid); if (J) J.stop = true;
  if (WORKER_IDS.has(cid)) await run(sb().from("ahs_jobs").update({ status: "stopped", finished: now() }).eq("kind", "cyv").eq("payload->>cid", cid).in("status", ["queued", "running"]));
  return { ok: 1 };
}

const CFG_KEYS = [...Object.keys(DEF)];
export async function checkerHandle(method: "GET" | "POST", path: string, _qs: URLSearchParams, raw: Buffer | null): Promise<[unknown, number?]> {
  try {
    if (method === "GET" && path === "state") return [await stateCached()];
    stateReset();
    const b = raw && raw.length ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {};
    const cid = String(b.id || "");
    if (path === "cfg") {
      const meta = metaOf(cid); if (!meta) throw new HsError("Checker không tồn tại");
      const c = await cfgGet(cid);
      const keys = [...CFG_KEYS, ...(meta.results || []).map((r) => r[0]), ...(meta.extra || []).map((e) => "xf_" + e.k), ...(meta.parts || []).map((p) => "pf_" + p.k)];
      const inc = (b.cfg || {}) as Record<string, unknown>;
      for (const k of keys) if (k in inc && k !== "last") c[k] = inc[k];
      if (typeof c.x !== "object" || c.x === null) c.x = {};
      c.threads = Math.max(1, Math.min(Number(c.threads) || 10, 64));
      c.timeout = Math.max(2, Math.min(Number(c.timeout) || 10, 60));
      c.every = Math.max(5, Number(c.every) || 60);
      await cfgSet(cid, c);
      return [{ ok: 1 }];
    }
    if (path === "run") return [await start(cid, Array.isArray(b.ids) ? (b.ids as Id[]) : null, b.scope as string | undefined)];
    if (path === "stop") return [await stop(cid)];
    return [{ error: "not found" }, 404];
  } catch (e) {
    if (e instanceof HsError) return [{ error: e.message }, e.status];
    return [{ error: e instanceof Error ? e.message : String(e) }, 500];
  }
}

/** _sched() của core.py: chạy checker bật "auto" khi tới hạn + áp kết quả job worker đang chờ.
 *  Gọi từ /api/hs/accountshs/internal/tick (worker gọi 5 phút/lần) thay cho luồng nền 20 giây. */
export async function cyvTick(): Promise<string[]> {
  const started: string[] = [];
  await state();                                                     // drain kết quả worker (FB…) vào dữ liệu
  for (const meta of ALL_METAS) {
    const cid = meta.id, c = await cfgGet(cid);
    if (!c.auto || JOBS.get(cid)?.running) continue;
    if (now() - Number(c.last || 0) < Math.max(5, Number(c.every) || 60) * 60) continue;
    try { await start(cid, null); started.push(cid); }
    catch { c.last = now(); await cfgSet(cid, c); }                   // không có gì để check → dời lịch như bản gốc
  }
  return started;
}
