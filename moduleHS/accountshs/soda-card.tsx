"use client";

// Soda (Trợ lý HireX) · kết quả tra Tài nguyên trong khung chat — vẽ giống khung chat Cú vọ (cùng bộ tra cứu bên dưới, cùng kết quả):
// câu trả lời ngắn, điều kiện đã hiểu, thống kê, vài dòng mẫu, gợi ý lọc tiếp.
// "Xem trên bảng" → mở Tài nguyên đúng tab, đúng phạm vi, bảng lọc sẵn đúng các dòng (như Cú vọ lọc bảng), KHÔNG hỏi lại;
// đang ở Tài nguyên thì câu trả lời mới tự lọc bảng luôn — khung Soda đóng vai khung chat của Tài nguyên.
// Thẻ đi kèm câu trả lời dạng <!--cuvo:…--> (server: server/soda.ts cardMarker); mở / lọc: host.tsx + ui/hirex-patch.js (hx: "owl-show").
import { ArrowRight, Search } from "lucide-react";

type O = Record<string, unknown>;
export type CuvoRow = { tab?: string; label: string; status?: string | null; owner?: string | null; color?: string | null; lk?: string };
export type CuvoNamed = { t: string; n: number; c?: string | null; spec?: O };
export type CuvoCard = { v: 1; q: string; kind: string; msg: string; count: number | null; chips: string[]; stats: CuvoNamed[]; groups: CuvoNamed[]; rows: CuvoRow[]; spec?: O | null; next?: string[]; auto?: boolean; fast?: boolean };

const MARK = /\n?<!--cuvo:([A-Za-z0-9_-]+)-->/g;
function decode(b64: string): CuvoCard | null {
  try {
    const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
    const c = JSON.parse(new TextDecoder().decode(Uint8Array.from(s, (ch) => ch.charCodeAt(0)))) as CuvoCard;
    return c && c.v === 1 && typeof c.q === "string" ? c : null;
  } catch { return null; }
}
/** Tách thẻ khỏi câu trả lời: chữ để vẽ như thường + các thẻ. */
export function splitCuvo(text: string): { text: string; cards: CuvoCard[] } {
  if (!text.includes("<!--cuvo:")) return { text, cards: [] };
  const cards: CuvoCard[] = [];
  const rest = text.replace(MARK, (_, b: string) => { const c = decode(b); if (c) cards.push(c); return ""; }).trimEnd();
  return { text: rest, cards };
}
/** Lịch sử gửi lại model: bỏ thẻ (model không cần, đỡ token). */
export const stripCuvo = (text: string) => text.includes("<!--cuvo:") ? text.replace(MARK, "").trimEnd() : text;

/** Xem trên bảng Tài nguyên với điều kiện của thẻ (hoặc của 1 nhóm). panel = khung Trợ lý thu gọn (Ctrl K). */
export function openCuvo(card: CuvoCard, panel: boolean, spec?: O | null) {
  window.dispatchEvent(new CustomEvent("hirex:cuvo-open", { detail: { q: card.q, spec: spec ?? card.spec ?? null, n: card.count, panel, from: window.location.pathname + window.location.search } }));
}
/** Câu trả lời mới: đang ở Tài nguyên → lọc bảng luôn (như Cú vọ); nơi khác mà người dùng nói "xem / liệt kê / danh sách" → tự mở Tài nguyên. */
export function cuvoAfterAnswer(answer: string, panel: boolean) {
  const cards = splitCuvo(answer).cards, onAccounts = window.location.pathname === "/accounts";
  const c = cards.find((x) => (onAccounts || x.auto) && (x.spec || x.groups.some((g) => g.spec)));
  if (c) window.setTimeout(() => openCuvo(c, panel, c.spec ?? c.groups.find((g) => g.spec)?.spec), onAccounts ? 0 : 500);
}
const ask = (q: string) => window.dispatchEvent(new CustomEvent("hirex:assistant-ask", { detail: { question: q } }));

const nf = (n: number) => n.toLocaleString("vi-VN");
const Dot = ({ c }: { c?: string | null }) => <i className="inline-block size-2 shrink-0 rounded-full" style={{ background: c || "#cbd5e1" }} />;

export function CuvoCardView({ card, panel }: { card: CuvoCard; panel: boolean }) {
  const multi = card.kind === "multi", groups = card.groups.slice(0, multi ? 12 : 10), mx = Math.max(1, ...groups.map((g) => g.n));
  const canOpen = !!card.spec || groups.some((g) => g.spec);
  return (
    <div className="hs-cuvo mt-1 space-y-2" role="group" aria-label="Kết quả tra Tài nguyên">
      <style>{".hs-cuvo{animation:hsCuvoIn .22s ease both}@keyframes hsCuvoIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}.hs-cuvo .bar i{transition:width .45s cubic-bezier(.22,1,.36,1)}@media (prefers-reduced-motion:reduce){.hs-cuvo,.hs-cuvo .bar i{animation:none;transition:none}}"}</style>
      {!multi && <p className="font-medium text-slate-900">{card.msg}</p>}
      {card.chips.length > 0 && <div className="flex flex-wrap gap-1">{card.chips.map((t, i) => <span key={i} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11.5px] text-slate-600">{t}</span>)}</div>}
      {card.stats.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-slate-600">{card.stats.map((s, i) => <span key={i} className="inline-flex items-center gap-1.5"><Dot c={s.c} />{s.t}<b className="font-semibold tabular-nums text-slate-900">{nf(s.n)}</b></span>)}</div>}
      {groups.length > 0 && <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">{groups.map((g, i) => {
        const row = <><span className="truncate text-slate-700">{g.t}</span><span className="bar h-1.5 overflow-hidden rounded-sm bg-slate-100"><i className="block h-full rounded-sm bg-blue-500/70" style={{ width: `${Math.max(4, (g.n / mx) * 100)}%`, ...(g.c ? { background: g.c } : {}) }} /></span><b className="text-right font-semibold tabular-nums text-slate-900">{nf(g.n)}</b></>;
        const cls = "grid w-full grid-cols-[minmax(0,8rem)_1fr_3.5rem] items-center gap-2 px-2.5 py-1.5 text-left text-[12px] border-t border-slate-100 first:border-t-0";
        return g.spec ? <button key={i} type="button" onClick={() => openCuvo(card, panel, g.spec)} title="Xem trên bảng" className={cls + " transition hover:bg-slate-50"}>{row}</button> : <div key={i} className={cls}>{row}</div>;
      })}</div>}
      {card.rows.length > 0 && <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">{card.rows.map((r, i) => <li key={i} className="flex h-8 items-center gap-2 border-t border-slate-100 px-2.5 text-[12px] first:border-t-0">
        <Dot c={r.color} /><span className="min-w-0 flex-1 truncate text-slate-800" title={[r.label, r.lk, r.status].filter(Boolean).join(" · ")}>{r.label}{r.lk && <span className="ml-1 text-slate-400">· {r.lk}</span>}</span>
        {r.tab && <span className="hidden shrink-0 text-slate-400 sm:inline">{r.tab}</span>}{r.owner && <span className="max-w-[6.5rem] shrink-0 truncate text-slate-500">{r.owner}</span>}</li>)}</ul>}
      {(canOpen || (card.next?.length ?? 0) > 0) && <div className="flex flex-wrap items-center gap-1.5">
        {canOpen && <button type="button" onClick={() => openCuvo(card, panel, card.spec ?? groups.find((g) => g.spec)?.spec)} className="group inline-flex h-7 items-center gap-1.5 rounded-md bg-blue-600 px-2.5 text-[12px] font-medium text-white transition hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
          Xem trên bảng{card.count !== null && card.count > card.rows.length ? <span className="tabular-nums opacity-80">{nf(card.count)}</span> : null}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>}
        {card.next?.map((t, i) => <button key={i} type="button" onClick={() => ask(`${card.q.replace(/[?.!\s]+$/u, "")} ${t}`)} title="Lọc tiếp trên kết quả này" className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-600 transition hover:border-blue-300 hover:text-blue-700"><Search className="size-3" />{t}</button>)}
      </div>}
    </div>
  );
}

/** Các thẻ của một câu trả lời (vẽ dưới phần chữ). */
export function CuvoCards({ cards, panel }: { cards: CuvoCard[]; panel: boolean }) {
  return <>{cards.map((c, i) => <CuvoCardView key={i} card={c} panel={panel} />)}</>;
}
