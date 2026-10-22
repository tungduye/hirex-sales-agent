"use client";

// Tài nguyên (AccountsHS) chạy sẵn ở nền trong toàn bộ HireX.
// - Vào bất kỳ trang nào của HireX: lúc trình duyệt rảnh (requestIdleCallback) thì nạp trang AccountsHS vào một iframe ẩn;
//   trong đó trang gốc tự tải dữ liệu, dựng chỉ mục và nạp ngầm cả các tab "Tải riêng" (ui/hirex-patch.js).
// - Mở /accounts: dùng lại đúng iframe đó, đặt khít vào ô #hs-acc-slot của trang → hiện ngay, không tải lại.
// - Iframe sống cùng khung HireX (app-shell), nên chuyển trang qua lại vẫn giữ nguyên bảng, bộ lọc, vị trí cuộn.
// - Mở /accounts khi trang trong chưa vẽ xong (mở thẳng link, F5): hiện ngay khung giả cùng bố cục (thanh trên, tab, bảng dòng giả),
//   trang trong vẽ xong khung thật (báo "accounts-ready") thì thay vào — không bao giờ thấy ô trắng. Khung giả = bố cục Tổng quan
//   (mở Tài nguyên luôn vào Tổng quan), trang trong lúc chờ dữ liệu cũng vẽ khung giả Tổng quan y hệt.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const SRC = "/api/hs/accountshs/ui";
type Box = { left: number; top: number; width: number; height: number };

export function HsAccountsHost({ enabled }: { enabled: boolean }) {
  const pathname = usePathname(), on = pathname === "/accounts";
  const [load, setLoad] = useState(false);
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
  const was = useRef(false);
  useEffect(() => { tell(); if (visible && !was.current) ref.current?.focus(); was.current = visible; });   // rẻ: trang trong chỉ xử lý khi trạng thái đổi
  if (!enabled || !load) return null;
  const sk = on && box && !ready ? box : null;
  return (<>
    {sk ? <Skeleton box={sk} /> : null}
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
