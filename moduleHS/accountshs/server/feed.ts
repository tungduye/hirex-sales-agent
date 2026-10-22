import "server-only";

/* Dòng thay đổi thời gian thực (Server-Sent Events) cho trang Tài nguyên.
 *
 *   máy chủ: 1 "bộ theo dõi" cho mỗi tiến trình Next, dùng chung cho mọi người đang mở trang
 *     · biết có thay đổi: (1) ngay sau mỗi lần ghi qua HireX (bumpVer → kick)
 *                         (2) Supabase Realtime báo bảng ahs_ver đổi (khi DB đã thêm ahs_ver vào publication supabase_realtime)
 *                         (3) hỏi ahs_ver mỗi giây — 1 truy vấn rất nhẹ / giây, KHÔNG nhân theo số người dùng
 *       → bắt được cả các nơi ghi khác (worker, bản Python, SQL tay)
 *     · có thay đổi → tính delta 1 lần (mọi tab) → đẩy tới mọi trình duyệt đang nối: event "delta" {from, ts, ver, …}
 *   trình duyệt: EventSource tự nối lại khi rớt mạng; nhận delta thì áp thẳng (không phải hỏi lại máy chủ),
 *     tự lọc các tab "tải riêng" chưa nạp; lỡ mất 1 đoạn (from > dữ liệu đang có) → tự tải delta bù như cũ.
 *   Không ai mở trang ~1 phút → bộ theo dõi tự dừng. Giữ kết nối qua Cloudflare: gửi ": ping" mỗi 20 giây. */
import { BUMP, T, now, safeTs, sb } from "./db";
import { dataVersion, getDelta } from "./accounts-data";
import type { Delta } from "../types";

type Client = { send: (chunk: string) => boolean };
const IDLE_STOP = 60;
const BIG = 2000;       // quá số dòng này: chỉ đẩy tín hiệu   // giây không có ai nối thì dừng

class Feed {
  clients = new Set<Client>();
  ver = -1;
  ts = 0;
  busy = false;
  again = false;
  idle = 0;
  timer: ReturnType<typeof setInterval> | null = null;
  hb: ReturnType<typeof setInterval> | null = null;
  rt: { unsubscribe: () => unknown } | null = null;

  add(c: Client) { this.clients.add(c); this.idle = 0; void this.start(); }
  remove(c: Client) { this.clients.delete(c); }

  async start() {
    if (this.timer) return;
    this.timer = setInterval(() => { if (!this.clients.size && ++this.idle > IDLE_STOP) this.stop(); else void this.tick(); }, 1000);
    this.hb = setInterval(() => this.broadcast(": ping\n\n"), 20000);
    BUMP.fn = () => { void this.tick(); };
    // Supabase Realtime: báo ngay khi ahs_ver đổi (cần ahs_ver trong publication supabase_realtime — có trong migration). Chỉ với Supabase thật.
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL || "").startsWith("https://") && process.env.HS_ACCOUNTS_REALTIME !== "0") try {
      this.rt = sb().channel("hs-accountshs-ver").on("postgres_changes", { event: "*", schema: "public", table: "ahs_ver" }, () => { void this.tick(); }).subscribe();
    } catch { this.rt = null; }
    try { this.ver = await dataVersion(); } catch { this.ver = -1; }
    this.ts = now();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.hb) clearInterval(this.hb);
    this.timer = this.hb = null;
    try { this.rt?.unsubscribe(); } catch { /* bỏ qua */ }
    this.rt = null; BUMP.fn = null; this.ver = -1;
  }
  broadcast(chunk: string) { for (const c of [...this.clients]) if (!c.send(chunk)) this.clients.delete(c); }

  /** hỏi ahs_ver; đổi → tính delta từ lần trước rồi đẩy cho mọi người. Đang tính dở mà có tin mới → tính thêm 1 lượt ngay sau. */
  async tick() {
    if (!this.clients.size) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    try {
      const v = await dataVersion();
      if (v !== this.ver) {
        const from = this.ts;
        // đếm trước: sửa hàng loạt hàng nghìn dòng thì chỉ cần báo tín hiệu (mỗi trình duyệt tự tải phần thay đổi),
        // không đọc cả chục MB dòng về máy chủ chỉ để bỏ đi
        const ts0 = safeTs(), { count } = await sb().from(T.accounts).select("id", { count: "exact", head: true }).gte("updated", from - 2);
        if ((count ?? 0) > BIG) {
          this.ver = v; this.ts = ts0 - 2;
          this.broadcast(`event: delta\ndata: ${JSON.stringify({ accounts: [], links: [], deleted: [], ts: ts0, delta: 1, big: count, from, ver: v })}\n\n`);
          return;
        }
        const d: Delta = await getDelta(from, "*");
        // lần sau tính lùi 2 giây: dòng đang ghi dở lúc tính (updated < ts nhưng chưa commit) không bao giờ bị sót; trùng thì trình duyệt tự gộp
        this.ver = v; this.ts = d.ts - 2;
        // thay đổi lớn (sửa hàng loạt hàng nghìn dòng): chỉ đẩy tín hiệu + danh sách xoá → mỗi trình duyệt tự tải phần thay đổi
        // (có thanh tiến trình), không dồn hàng chục MB qua kết nối thời gian thực của mọi người
        const big = d.accounts.length > BIG;
        const ev = big ? { ...d, accounts: [], links: [], big: d.accounts.length, from, ver: v } : { ...d, from, ver: v };
        this.broadcast(`event: delta\ndata: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (e) { console.error("[accountshs] feed", e instanceof Error ? e.message : e); }
    finally {
      this.busy = false;
      if (this.again) { this.again = false; setTimeout(() => void this.tick(), 0); }
    }
  }
}

const G = globalThis as typeof globalThis & { __hsAccountsFeed?: Feed };
const feed = (G.__hsAccountsFeed ??= new Feed());

/** GET /api/hs/accountshs/events — luồng SSE. Mở đầu bằng "hello" (ver + ts của máy chủ) để trình duyệt tự bù phần còn thiếu. */
export function eventsResponse(): Response {
  const enc = new TextEncoder();
  let me: Client | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(ctl) {
      me = { send: (s) => { try { ctl.enqueue(enc.encode(s)); return true; } catch { return false; } } };
      me.send(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ ts: now() })}\n\n`);
      feed.add(me);
    },
    cancel() { if (me) feed.remove(me); },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
