"use client";

// Tài nguyên (AccountsHS) chạy sẵn ở nền trong toàn bộ HireX.
// - Vào bất kỳ trang nào của HireX: lúc trình duyệt rảnh (requestIdleCallback) thì nạp trang AccountsHS vào một iframe ẩn;
//   trong đó trang gốc tự tải dữ liệu, dựng chỉ mục và nạp ngầm cả các tab "Tải riêng" (ui/hirex-patch.js).
// - Mở /accounts: dùng lại đúng iframe đó, đặt khít vào ô #hs-acc-slot của trang → hiện ngay, không tải lại.
// - Iframe sống cùng khung HireX (app-shell), nên chuyển trang qua lại vẫn giữ nguyên bảng, bộ lọc, vị trí cuộn.
// - Mở /accounts khi trang trong chưa vẽ xong (mở thẳng link, F5): hiện ngay khung giả cùng bố cục (thanh trên, tab, bảng dòng giả),
//   trang trong vẽ xong khung thật (báo "accounts-ready") thì thay vào — không bao giờ thấy ô trắng. Khung giả = bố cục Tổng quan
//   (mở Tài nguyên luôn vào Tổng quan), trang trong lúc chờ dữ liệu cũng vẽ khung giả Tổng quan y hệt.
// - Soda (Trợ lý) bấm "Mở trong Tài nguyên" trên thẻ Cú vọ (soda-card.tsx → sự kiện "hirex:cuvo-open"): chuyển sang /accounts, gửi câu hỏi
//   điều kiện lọc vào iframe (hx: "owl-show" → ui/hirex-patch.js lọc bảng đúng tab / phạm vi / đúng các dòng như Cú vọ, không hỏi lại).
//   Khung Soda vẫn mở cạnh bảng (đóng vai khung chat của Tài nguyên); đi từ trang Trợ lý thì khung Soda mở tiếp đúng cuộc trò chuyện
//   + nút "Quay lại Trợ lý" góc dưới trái.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const SRC = "/api/hs/accountshs/ui";
type Box = { left: number; top: number; width: number; height: number };
type Back = { from: string; panel: boolean; q: string; n: number | null; at: number };
const BACK_KEY = "hx-cuvo-back";

export function HsAccountsHost({ enabled }: { enabled: boolean }) {
  const pathname = usePathname(), on = pathname === "/accounts", router = useRouter();
  const [load, setLoad] = useState(false);
  // Soda → Tài nguyên: điều kiện chờ gửi vào bảng + chỗ quay lại
  const ask = useRef<{ q: string; spec: Record<string, unknown> | null } | null>(null);
  const [askN, setAskN] = useState(0);
  const [back, setBack] = useState<Back | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => { try { const b = JSON.parse(sessionStorage.getItem(BACK_KEY) || "null") as Back | null; if (b && Date.now() - b.at < 3600e3) setBack(b); } catch { /* storage tắt */ } }, 0);
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ q?: string; spec?: Record<string, unknown> | null; n?: number | null; panel?: boolean; from?: string }>).detail; if (!d?.q) return;
      const from = d.from || "/assistant", here = window.location.pathname === "/accounts";
      ask.current = { q: String(d.q).slice(0, 300), spec: d.spec ?? null }; setAskN((n) => n + 1); setLoad(true);
      if (!d.panel && !here) {   // từ trang Trợ lý: nhớ chỗ quay lại, mở khung Soda tiếp đúng cuộc trò chuyện
        const b: Back = { from, panel: false, q: String(d.q).slice(0, 300), n: d.n ?? null, at: Date.now() };
        setBack(b); try { sessionStorage.setItem(BACK_KEY, JSON.stringify(b)); } catch { /* storage tắt */ }
        const conversationId = /\/assistant\/c\/([0-9a-f-]{36})/i.exec(from)?.[1];
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("hirex:assistant-open", { detail: { conversationId } })), 350);
      }
      if (!here) router.push("/accounts");
    };
    window.addEventListener("hirex:cuvo-open", f);
    return () => { window.clearTimeout(t); window.removeEventListener("hirex:cuvo-open", f); };
  }, [router]);
  // rời Tài nguyên bằng đường khác → bỏ nút quay lại
  const wasOn = useRef(on);
  useEffect(() => { if (wasOn.current && !on) { setBack(null); try { sessionStorage.removeItem(BACK_KEY); } catch { /* storage tắt */ } } wasOn.current = on; }, [on]);
  function goBack() {
    const b = back; setBack(null); try { sessionStorage.removeItem(BACK_KEY); } catch { /* storage tắt */ }
    if (!b) return;
    if (b.from !== "/accounts") router.push(b.from);
    if (b.panel) window.setTimeout(() => window.dispatchEvent(new Event("hirex:assistant-open")), 180);
    else window.dispatchEvent(new Event("hirex:assistant-close"));   // về trang Trợ lý: trang đó là khung chat, thu khung nổi lại
  }
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const f = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.hx === "accounts-ready") setReady(true); };
    window.addEventListener("message", f);
    return () => window.removeEventListener("message", f);
  }, []);
  // phòng khi không nhận được tin (trang trong lỗi): 10 giây sau vẫn hiện trang thật
  useEffect(() => { if (!load || ready) return; const t = window.setTimeout(() => setReady(true), 10000); return () => window.clearTimeout(t); }, [load, ready]);
  const ref = useRef<HTMLIFrameElement>(null);

  // nạp ngầm khi trình duyệt rảnh (không tranh tài nguyên với trang đang mở); mở thẳng /accounts thì nạp ngay
  useEffect(() => {
    if (!enabled || load) return;
    if (on) { setLoad(true); return; }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const t = window.setTimeout(() => {
      if (w.requestIdleCallback) w.requestIdleCallback(() => setLoad(true), { timeout: 2000 }); else setLoad(true);
    }, 300);
    return () => window.clearTimeout(t);
  }, [enabled, load, on]);

  // đặt iframe khít ô của trang /accounts (theo dõi đổi cỡ: thu gọn menu, xoay màn hình…)
  useEffect(() => {
    if (!on) return;
    let ro: ResizeObserver | null = null, raf = 0, el: HTMLElement | null = null;
    const upd = () => { if (!el) return; const r = el.getBoundingClientRect(); setBox({ left: r.left, top: r.top, width: r.width, height: r.height }); };
    const find = () => {
      el = document.getElementById("hs-acc-slot");
      if (!el) { raf = requestAnimationFrame(find); return; }
      upd(); ro = new ResizeObserver(upd); ro.observe(el);
    };
    find(); window.addEventListener("resize", upd);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener("resize", upd); };
  }, [on]);

  const show = on && box && ready ? box : null;
  // báo cho trang trong iframe đang hiện hay chạy nền (ui/hirex-patch.js: hỏi dữ liệu mới 4 giây/lần khi hiện, 20 giây/lần khi nền)
  const visible = !!show;
  const tell = () => ref.current?.contentWindow?.postMessage({ hx: "accounts-active", on: visible }, window.location.origin);
  // câu hỏi từ Soda: gửi khi iframe đã hiện (trang trong tự chờ dữ liệu + Cú vọ sẵn sàng)
  useEffect(() => { if (!visible || !ask.current) return; const a = ask.current; ask.current = null; ref.current?.contentWindow?.postMessage(a.spec ? { hx: "owl-show", spec: a.spec } : { hx: "owl-ask", text: a.q }, window.location.origin); }, [visible, askN]);
  const was = useRef(false);
  useEffect(() => { tell(); if (visible && !was.current) ref.current?.focus(); was.current = visible; });   // rẻ: trang trong chỉ xử lý khi trạng thái đổi
  if (!enabled || !load) return null;
  const sk = on && box && !ready ? box : null;
  const pill = on && back && box ? box : null;
  return (<>
    {sk ? <Skeleton box={sk} /> : null}
    {pill && back ? <BackPill box={pill} back={back} onBack={goBack} onClose={() => { setBack(null); try { sessionStorage.removeItem(BACK_KEY); } catch { /* storage tắt */ } }} /> : null}
    <iframe
      ref={ref}
      src={SRC}
      onLoad={tell}
      title="Tài nguyên"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      style={show
        ? { position: "fixed", left: show.left, top: show.top, width: show.width, height: show.height, border: 0, background: "#fff", zIndex: 20 }
        // ẩn nhưng vẫn dựng giao diện ở kích thước màn hình (mở ra không phải vẽ lại từ đầu)
        : { position: "fixed", left: 0, top: 0, width: box?.width ?? "100vw", height: box?.height ?? "100vh", border: 0, visibility: "hidden", pointerEvents: "none", zIndex: -1 }}
    />
  </>);
}

/** Nút nổi "Quay lại Trợ lý" (góc dưới trái ô Tài nguyên) khi tới đây từ thẻ Cú vọ của Soda. */
function BackPill({ box, back, onBack, onClose }: { box: Box; back: Back; onBack: () => void; onClose: () => void }) {
  return (
    <div role="group" aria-label="Quay lại Trợ lý" style={{ position: "fixed", left: box.left + 16, bottom: Math.max(16, window.innerHeight - (box.top + box.height) + 16), zIndex: 26, maxWidth: Math.min(420, box.width - 32) }}
      className="hx-backpill flex items-center gap-1 rounded-full bg-slate-900 p-1 pr-1.5 text-white shadow-xl ring-1 ring-white/10">
      <style>{".hx-backpill{animation:hxBack .32s cubic-bezier(.22,1,.36,1) both}@keyframes hxBack{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){.hx-backpill{animation:none}}"}</style>
      <button type="button" onClick={onBack} className="flex min-w-0 items-center gap-2 rounded-full py-1.5 pl-2.5 pr-3 text-left transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        <span className="flex min-w-0 flex-col leading-tight"><b className="text-[13px] font-semibold">Quay lại Trợ lý</b><span className="truncate text-[11px] text-slate-300">“{back.q}”{back.n !== null ? ` · ${back.n.toLocaleString("vi-VN")}` : ""}</span></span>
      </button>
      <button type="button" onClick={onClose} title="Ẩn" aria-label="Ẩn nút quay lại" className="grid size-7 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}

/** Khung giả cùng bố cục trang Tài nguyên lúc mở (Tổng quan): thanh trên · tab · cây phạm vi bên trái · thẻ số + bảng nền tảng bên phải.
 *  Giống khung giả Tổng quan của chính trang trong (ovSkel) → lúc thay bằng trang thật không bị đổi bố cục. */
function Skeleton({ box }: { box: Box }) {
  const bar = (w: number | string, h = 10, r = 6) => ({ width: w, height: h, borderRadius: r, background: "#e9edf3" });
  const line = "1px solid #eef1f5";
  const d = (i: number) => ({ animationDelay: `${(i * 0.06) % 1.2}s` });
  const tree = Math.max(8, Math.ceil((box.height - 190) / 34));
  const W = [62, 48, 70, 55, 66, 44, 58, 52, 68, 46, 60, 50];
  return (
    <div aria-busy="true" aria-label="Đang mở Tài nguyên" style={{ position: "fixed", left: box.left, top: box.top, width: box.width, height: box.height, zIndex: 21, background: "#fff", overflow: "hidden", fontFamily: "inherit" }}>
      <style>{"@keyframes hxsk{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}.hxsk{animation:hxsk 1.2s ease-in-out infinite}"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 52, padding: "0 16px", borderBottom: line }}>
        <div className="hxsk" style={bar(56, 14)} /><div className="hxsk" style={bar(180, 30, 8)} /><div style={{ flex: 1 }} /><div className="hxsk" style={bar(90, 26, 8)} /><div className="hxsk" style={bar(90, 26, 8)} />
      </div>
      <div style={{ display: "flex", gap: 28, height: 40, alignItems: "center", padding: "0 24px", borderBottom: line }}>
        {[86, 96, 130, 120, 70, 70].map((w, i) => <div key={i} className="hxsk" style={{ ...bar(w, 12), ...d(i) }} />)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 440px) minmax(0, 1fr)", gap: 14, padding: 14, height: "calc(100% - 92px)", boxSizing: "border-box" }}>
        <div style={{ border: line, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", gap: 18, alignItems: "center", height: 40, padding: "0 14px", background: "#f7f9fb", borderBottom: line }}>
            <div className="hxsk" style={{ ...bar(130, 10), flex: "none" }} /><div style={{ flex: 1 }} />{[30, 26, 26].map((w, k) => <div key={k} className="hxsk" style={bar(w, 10)} />)}
          </div>
          {Array.from({ length: tree }, (_, i) => (
            <div key={i} style={{ display: "flex", gap: 18, alignItems: "center", height: 34, padding: `0 14px 0 ${i % 4 ? 38 : 14}px` }}>
              <div className="hxsk" style={{ ...bar(`${W[i % W.length] * (i % 4 ? 0.7 : 1)}%`, 10), maxWidth: 200, ...d(i) }} /><div style={{ flex: 1 }} />
              {[30, 26, 26].map((w, k) => <div key={k} className="hxsk" style={{ ...bar(w, 10), ...d(i + k) }} />)}
            </div>
          ))}
        </div>
        <div style={{ border: line, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", height: 56, padding: "0 18px", borderBottom: line }}><div className="hxsk" style={bar(160, 14)} /><div style={{ flex: 1 }} /><div className="hxsk" style={bar(72, 28, 8)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", borderBottom: line }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ padding: "16px 18px", borderLeft: i ? line : undefined, display: "grid", gap: 10 }}>
                <div className="hxsk" style={{ ...bar("40%", 9), ...d(i) }} /><div className="hxsk" style={{ ...bar("62%", 22, 7), ...d(i + 1) }} /><div className="hxsk" style={{ ...bar("30%", 9), ...d(i + 2) }} />
              </div>
            ))}
          </div>
          <div style={{ margin: 18, border: line, borderRadius: 10, overflow: "hidden", maxWidth: 680 }}>
            <div style={{ height: 38, background: "#f7f9fb", borderBottom: line }} />
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} style={{ display: "flex", gap: 30, alignItems: "center", height: 42, padding: "0 16px", borderBottom: "1px solid #f2f4f7" }}>
                <div className="hxsk" style={{ ...bar(110, 10), ...d(i) }} /><div style={{ flex: 1 }} />{[34, 34, 30, 30, 34].map((w, k) => <div key={k} className="hxsk" style={{ ...bar(w, 10), ...d(i + k) }} />)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
