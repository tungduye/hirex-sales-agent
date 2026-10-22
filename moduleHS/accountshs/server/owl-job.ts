/* Cú vọ — chạy 1 việc 'owl' (port 1:1 của OwlCtx + run_owl trong worker/hs-accountshs-worker.py).
   Thuần logic, không đụng DB trực tiếp: đọc/ghi việc qua JobIO (bản thật ở owl-run.ts, bản thử ở bài kiểm thử).
   Cách ghi tiến trình giữ y bản Python: progress = {status, rows, logs, ts}, ghi lại toàn bộ mỗi lần có bài/nhật ký mới,
   còn dòng trạng thái thì tối đa 1 lần/giây; việc bị "Dừng" (status stopped/failed trong DB) thì ngắt ngay vòng lặp gần nhất. */
import * as PF from "./owl-postfb";

export interface JobIO {
  status(id: number): Promise<string>;
  set(id: number, cols: { status?: string; progress?: unknown; started?: number; finished?: number }): Promise<void>;
}
type Row = Record<string, unknown>;
const nowS = () => Date.now() / 1000;
const hms = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** kiểm tra việc có bị dừng không tối đa mỗi STOP_POLL giây (Python hỏi DB mỗi 0,1 giây qua kết nối trực tiếp; đây đi qua HTTP nên thưa hơn) */
const STOP_POLL = 0.3;

export class OwlCtx implements PF.Ctx {
  rows: Row[] = [];
  logs: Array<{ t: string; msg: string; kind: string }> = [];
  statusS = "Bắt đầu…";
  stop = false;
  src: unknown = undefined;
  private last = 0;
  private lastStopCheck = 0;
  constructor(private io: JobIO, private jid: number) {}
  private async refreshStop() {
    const t = nowS();
    if (t - this.lastStopCheck < STOP_POLL) return;
    this.lastStopCheck = t;
    const s = await this.io.status(this.jid);
    if (s === "stopped" || s === "failed") this.stop = true;
  }
  async emit(rows: Row[]) {
    for (const r of rows) if (r && typeof r === "object" && this.src !== undefined && this.src !== null && !("_src" in r)) r._src = this.src;
    for (const r of rows) this.rows.push(r);
    await this.flush(true);
  }
  async log(msg: string, kind = "info") { this.logs.push({ t: hms(), msg: String(msg), kind }); await this.flush(true); }
  async status(s: string) { this.statusS = String(s); await this.flush(); }
  async stopped() { await this.refreshStop(); return this.stop; }
  async sleep(s: number) {
    const end = nowS() + Math.max(0, s);
    while (nowS() < end && !(await this.stopped())) await wait(100);
  }
  saveRaw() { /* worker cũng không lưu raw */ }
  async flush(force = false) {
    if (!force && nowS() - this.last < 1.0) return;
    this.last = nowS();
    await this.io.set(this.jid, { progress: { status: this.statusS, rows: this.rows, logs: this.logs, ts: nowS() } });
  }
}

export interface OwlMod { run: typeof PF.run; Fail: new (...a: never[]) => Error }
export const OWL_MODS: Record<string, OwlMod> = { fb_page_group_posts: { run: PF.run, Fail: PF.Fail } };

/** run_owl(conn, job) */
export async function runOwlJob(io: JobIO, job: { id: number; payload: Record<string, unknown> }, mods: Record<string, OwlMod> = OWL_MODS): Promise<void> {
  const jid = job.id, p = job.payload || {};
  const mod = mods[String(p.script)];
  if (!mod) throw new Error(`'${String(p.script)}'`);                 // Python: KeyError → việc báo failed
  const sources = (Array.isArray(p.sources) ? p.sources : []) as Array<Record<string, unknown>>;
  const params: Record<string, unknown> = { ...((p.params as Record<string, unknown>) || {}) };
  const dft = (p.defaults as Record<string, unknown>) || {};
  const gap = Number(PF.truthy(params.page_gap) ? params.page_gap : PF.truthy(dft.page_gap) ? dft.page_gap : 4);
  const ctx = new OwlCtx(io, jid);
  try {
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i], label = String(src.label ?? "");
      if (await ctx.stopped()) break;
      await ctx.status(`Nguồn ${i + 1}/${sources.length}: ${label}`);
      if (!PF.truthy(src.cookie)) { await ctx.log(`${label}: không lấy được cookie`, "warn"); continue; }
      try {
        ctx.src = src.id ?? null;
        await mod.run(ctx, src, params);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (e instanceof mod.Fail) await ctx.log(`${label}: ${m}`, "err");
        else { await ctx.log(`${label}: lỗi ${m}`, "err"); console.error("[owl]", e); }
      }
      if (PF.truthy(gap) && i < sources.length - 1 && !(await ctx.stopped())) await ctx.sleep(gap);
    }
    await ctx.status(`Xong · ${ctx.rows.length} dòng${(await ctx.stopped()) ? " · đã dừng" : ""}`);
  } catch (e) {
    await ctx.status(`Lỗi: ${e instanceof Error ? e.message : String(e)}`);
    console.error("[owl]", e);
  }
  await ctx.flush(true);
  await io.set(jid, { status: ctx.stop ? "stopped" : "done", finished: nowS() });
}
