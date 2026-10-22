import "server-only";

import { now, run, sb } from "./db";
import { runOwlJob, type JobIO } from "./owl-job";

/* Cú vọ tự động — chạy việc 'owl' ngay trong máy chủ Node (thay cho worker Python owl_postfb.py).
   Việc vẫn đi qua bảng ahs_jobs như cũ nên giao diện, nút Dừng/Tạm dừng và "Đồng bộ vào tab" không đổi gì.
   · Mỗi lần chạy xong claim (UPDATE … WHERE status='queued') rồi mới chạy — nếu worker Python đang bật và nhận trước thì Node bỏ qua, không bao giờ chạy đôi.
   · Chạy lần lượt từng việc (như worker Python xử lý 1 việc/lần) để không dồn dập vào Facebook.
   · AHS_OWL_ENGINE=python  → quay về cách cũ (chỉ xếp hàng, chờ worker Python). Mặc định: node. */
export const owlEngine = (): "node" | "python" => ((process.env.AHS_OWL_ENGINE || "node").trim().toLowerCase() === "python" ? "python" : "node");

const dbIO: JobIO = {
  async status(id) {
    const r = await run<{ status: string } | null>(sb().from("ahs_jobs").select("status").eq("id", id).maybeSingle());
    return r ? r.status : "stopped";
  },
  async set(id, cols) { await run(sb().from("ahs_jobs").update(cols).eq("id", id)); },
};

interface St { chain: Promise<void>; pending: Set<number>; live: Set<number> }
const G = globalThis as unknown as { __ahsOwlRun?: St };
const st = (): St => (G.__ahsOwlRun ??= { chain: Promise.resolve(), pending: new Set(), live: new Set() });
/** Việc này đang do chính tiến trình Node giữ (chờ tới lượt hoặc đang chạy)? */
export const owlTracked = (id: number) => { const s = st(); return s.pending.has(id) || s.live.has(id); };

async function claimAndRun(id: number) {
  const got = await run<Array<{ id: number; payload: Record<string, unknown> | null }>>(
    sb().from("ahs_jobs").update({ status: "running", started: now(), by: "node" }).eq("id", id).eq("status", "queued").select("id,payload"));
  if (!got.length) return;                                              // đã bị dừng, hoặc worker Python nhận trước
  try { await runOwlJob(dbIO, { id, payload: got[0].payload || {} }); }
  catch (e) {                                                           // như vòng lặp chính của worker: việc báo failed + lý do
    console.error("[owl] việc #" + id, e);
    await run(sb().from("ahs_jobs").update({ status: "failed", progress: { err: e instanceof Error ? e.message : String(e), ts: now() }, finished: now() }).eq("id", id)).catch(() => undefined);
  }
}
/** Xếp việc 'owl' (đã insert ở trạng thái queued) vào hàng chạy của Node. Gọi nhiều lần cho cùng một việc cũng chỉ chạy một lần. */
export function enqueueOwl(id: number) {
  const s = st();
  if (s.pending.has(id) || s.live.has(id)) return;
  s.pending.add(id);
  s.chain = s.chain.then(async () => {
    s.pending.delete(id); s.live.add(id);
    try { await claimAndRun(id); } catch (e) { console.error("[owl] việc #" + id, e); } finally { s.live.delete(id); }
  });
}

const STALE = 300;
/** Gọi mỗi lần giao diện hỏi tiến trình (trả true nếu vừa đổi trạng thái việc): việc 'queued' mà Node chưa giữ (máy chủ vừa khởi động lại) thì xếp lại; việc do Node chạy
 *  mà im lặng quá 5 phút và không còn trong bộ nhớ (máy chủ bị khởi động lại giữa chừng) thì báo failed để giao diện không treo. */
export async function owlHeal(row: { id: number; status: string; by: string | null; progress: Record<string, unknown> | null }): Promise<boolean> {
  if (owlEngine() !== "node" || owlTracked(row.id)) return false;
  if (row.status === "queued") { enqueueOwl(row.id); return false; }
  if ((row.status === "running" || row.status === "paused") && row.by === "node") {
    const ts = Number(row.progress?.ts || 0);
    if (ts && now() - ts > STALE) {
      await run(sb().from("ahs_jobs").update({ status: "failed", finished: now(), progress: { ...(row.progress || {}), status: "Bị ngắt giữa chừng (máy chủ khởi động lại) — chạy lại để tiếp tục" } }).eq("id", row.id).in("status", ["running", "paused"])).catch(() => undefined);
      return true;
    }
  }
  return false;
}
