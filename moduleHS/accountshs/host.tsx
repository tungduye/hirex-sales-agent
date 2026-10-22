"use client";

// Tài nguyên (AccountsHS) chạy sẵn ở nền trong toàn bộ HireX.
// - Vào bất kỳ trang nào của HireX: lúc trình duyệt rảnh (requestIdleCallback) thì nạp trang AccountsHS vào một iframe ẩn;
//   trong đó trang gốc tự tải dữ liệu, dựng chỉ mục và nạp ngầm cả các tab "Tải riêng" (ui/hirex-patch.js).
// - Mở /accounts: dùng lại đúng iframe đó, đặt khít vào ô #hs-acc-slot của trang → hiện ngay, không tải lại.
// - Iframe sống cùng khung HireX (app-shell), nên chuyển trang qua lại vẫn giữ nguyên bảng, bộ lọc, vị trí cuộn.
// - Mở /accounts khi trang trong chưa vẽ xong (mở thẳng link, F5): hiện ngay khung giả cùng bố cục (thanh trên, tab, bảng dòng giả),
//   trang trong vẽ xong khung thật (báo "accounts-ready") thì thay vào — không bao giờ thấy ô trắng.
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

/** Khung giả cùng bố cục trang Tài nguyên: thanh trên · tab · thanh công cụ · bảng dòng giả (nhấp nháy nhẹ). */
function Skeleton({ box }: { box: Box }) {
  const bar = (w: number | string, h = 10, r = 6) => ({ width: w, height: h, borderRadius: r, background: "#e9edf3" });
  const rows = Math.max(6, Math.ceil((box.height - 230) / 46));
  return (
    <div aria-busy="true" aria-label="Đang mở Tài nguyên" style={{ position: "fixed", left: box.left, top: box.top, width: box.width, height: box.height, zIndex: 21, background: "#fff", overflow: "hidden", fontFamily: "inherit" }}>
      <style>{"@keyframes hxsk{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}.hxsk{animation:hxsk 1.2s ease-in-out infinite}"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 52, padding: "0 16px", borderBottom: "1px solid #eef1f5" }}>
        <div className="hxsk" style={bar(70, 14)} /><div className="hxsk" style={bar(180, 30, 8)} /><div style={{ flex: 1 }} /><div className="hxsk" style={bar(90, 26, 8)} /><div className="hxsk" style={bar(90, 26, 8)} />
      </div>
      <div style={{ display: "flex", gap: 28, height: 40, alignItems: "center", padding: "0 24px", borderBottom: "1px solid #eef1f5" }}>
        {[80, 90, 120, 110, 70, 70].map((w, i) => <div key={i} className="hxsk" style={{ ...bar(w, 12), animationDelay: `${i * 0.06}s` }} />)}
      </div>
      <div style={{ display: "flex", gap: 10, padding: "14px 16px" }}>
        <div className="hxsk" style={bar(300, 32, 8)} /><div className="hxsk" style={bar(80, 32, 8)} /><div style={{ flex: 1 }} /><div className="hxsk" style={bar(120, 32, 8)} /><div className="hxsk" style={bar(84, 32, 8)} />
      </div>
      <div style={{ margin: "4px 16px 0", border: "1px solid #eef1f5", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ height: 38, background: "#f7f9fb", borderBottom: "1px solid #eef1f5" }} />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: "flex", gap: 24, alignItems: "center", height: 46, padding: "0 16px", borderBottom: "1px solid #f2f4f7" }}>
            {[14, 90, 110, 80, 160, 120, 90].map((w, k) => <div key={k} className="hxsk" style={{ ...bar(w * (0.75 + ((i * 7 + k * 13) % 10) / 20)), animationDelay: `${((i * 0.06) + (k * 0.025)) % 1.2}s` }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}
