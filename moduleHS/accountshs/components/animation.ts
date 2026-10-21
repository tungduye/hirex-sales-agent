"use client";

// core_animation (port của /home/claude/ahs_src/_core_animation.js · core_animation/core_animation.py) cho AccountsHS trong React.
// CSS đã có sẵn trong accountshs.css (scope .hs-acc). Chỉ tác động phần tử nằm trong .hs-acc (khung app + lớp nổi .hs-acc.hs-layer).
//  1) menu/popup mọc ra từ nơi vừa bấm (--ca-ox)            2) popup/hộp thoại bị gỡ → giữ lại làm "bóng" mờ dần (.ca-out)
//  3) gạch chân tab trượt (.ca-ind)                          4a) countUp: số tự chạy lên
//  4b) nút/dòng vừa mở menu giữ dấu .ca-open tới khi menu đóng 4c) nền trượt của .ovsw (Tổng quan / Chi tiết)
//  5) hộp thoại / sheet bung ra từ nút vừa bấm (fly)
// Tắt: caOff() (html.ca-off + .hs-acc.ca-off, localStorage ca_off = '1'); bật lại: caEnable().
// Không theo prefers-reduced-motion — cố ý như bản gốc (Windows tắt "hiệu ứng" vẫn cần phản hồi trực quan).

export const CA = {
  on: true,
  T: 90, tab: 130, slide: 240, fly_in: 300, fly_out: 200,
  ease: "cubic-bezier(.22,1,.36,1)", spring: "cubic-bezier(.34,1.38,.64,1)",
};
export const caActive = () => CA.on;
const markOff = (off: boolean) => {
  document.documentElement.classList.toggle("ca-off", off);
  document.querySelectorAll(".hs-acc").forEach((e) => e.classList.toggle("ca-off", off));
};
export function caOff() { CA.on = false; markOff(true); try { localStorage.setItem("ca_off", "1"); } catch { /* bộ nhớ trình duyệt bị khoá */ } }
export function caEnable() { CA.on = true; markOff(false); try { localStorage.removeItem("ca_off"); } catch { /* bộ nhớ trình duyệt bị khoá */ } }

const inHs = (n: Element | null | undefined) => !!n && !!n.closest?.(".hs-acc");
const isEl = (n: Node): n is HTMLElement => n.nodeType === 1;
const cls = (n: Element, c: string) => n.classList.contains(c);

/** 5) "mở app / đóng app" kiểu macOS: cửa sổ bung ra từ điểm (ox, oy) — toạ độ cục bộ của cửa sổ. */
export function fly(el: HTMLElement | null, from: "open" | "close", ox: number, oy: number): Animation | null {
  if (!el || typeof el.animate !== "function") return null;
  el.style.transformOrigin = ox + "px " + oy + "px";
  const open = from === "open";
  const kf = open ? [{ transform: "scale(.1)", opacity: 0 }, { transform: "scale(.72)", opacity: 0.85, offset: 0.45 }, { transform: "scale(1)", opacity: 1 }]
    : [{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.12)", opacity: 0 }];
  return el.animate(kf, { duration: open ? CA.fly_in : CA.fly_out, easing: open ? "cubic-bezier(.2,.92,.28,1.02)" : "cubic-bezier(.5,0,.8,.4)", fill: open ? "none" : "forwards" });
}
let lastBtn: { r: DOMRect; t: number } | null = null;
/** điểm xuất phát: tâm nút vừa bấm (hoặc nút bấm gần nhất trong 1,5s), đổi sang toạ độ cục bộ của cửa sổ */
export function srcPoint(win: HTMLElement, btn?: HTMLElement | null): [number, number] | null {
  const r = win.getBoundingClientRect();
  let b: DOMRect | null = btn ? btn.getBoundingClientRect() : null;
  if (!b || !b.width) { if (lastBtn && Date.now() - lastBtn.t < 1500) b = lastBtn.r; else return null; }
  return [Math.round(b.left + b.width / 2 - r.left), Math.round(b.top + b.height / 2 - r.top)];
}

/** 4a) số tự chạy lên (0 → giá trị) khi khung số liệu bung ra, ≈0,3s, dừng mềm */
export function countUp(root: Element | null, sel = ".ovkc b") {
  if (!root || !CA.on) return;
  root.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
    const txt = el.textContent || "", v = parseInt(txt.replace(/\D/g, ""), 10); if (!v || v < 2) return;
    const t0 = performance.now() + i * 25, d = 300, f = (n: number) => n.toLocaleString("vi"); el.textContent = "0";
    const step = (now: number) => { if (!el.isConnected) return; const k = Math.min(1, Math.max(0, (now - t0) / d)), e = 1 - Math.pow(1 - k, 4); el.textContent = k >= 1 ? txt : f(Math.round(v * e)); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

/** installAnimation(root): gắn mọi hiệu ứng; trả về hàm gỡ. root = phần tử .hs-acc của app. */
export function installAnimation(root: HTMLElement): () => void {
  if (typeof window === "undefined" || !root) return () => undefined;
  const offs: Array<() => void> = [];
  const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void) => { document.addEventListener(t, f, true); offs.push(() => document.removeEventListener(t, f, true)); };
  try { if (localStorage.getItem("ca_off") === "1") CA.on = false; } catch { /* bộ nhớ trình duyệt bị khoá */ }
  markOff(!CA.on);

  /* ── nhớ nơi vừa bấm (1, 4b, 5) ── */
  let last: { r: DOMRect; x: number; y: number; t: number } | null = null;
  let src: { el: HTMLElement; t: number } | null = null;
  on("pointerdown", (e) => {
    const tg = e.target instanceof Element ? e.target : null;
    if (!inHs(tg)) { last = null; src = null; lastBtn = null; return; }
    const t1 = tg!.closest<HTMLElement>("button,[data-a],.tab,.btn,.fchip,.cn,td,th,[role=button]");
    last = t1 ? { r: t1.getBoundingClientRect(), x: e.clientX, y: e.clientY, t: Date.now() } : null;
    const t2 = tg!.closest<HTMLElement>("button,[data-a],.tab,.btn,.chip,tr,[role=button]");
    src = (t2 && !t2.closest(".pop")) || (t2 && cls(t2, "mi")) ? { el: t2, t: Date.now() } : null;
    const t3 = tg!.closest<HTMLElement>("button,[data-a],.tab,.btn");
    lastBtn = t3 ? { r: t3.getBoundingClientRect(), t: Date.now() } : null;
  });
  on("keydown", () => { last = null; src = null; lastBtn = null; });
  const origin = (p: HTMLElement) => {
    if (!last || Date.now() - last.t > 1500) return;
    const r = p.getBoundingClientRect(); if (!r.width || !r.height) return;
    const ax = Math.min(Math.max(last.r.left + last.r.width / 2, r.left), r.right);
    const ay = last.r.top + last.r.height / 2 < r.top ? r.top : last.r.top > r.bottom ? r.bottom : Math.min(Math.max(last.y, r.top), r.bottom);
    p.style.setProperty("--ca-ox", Math.round(ax - r.left) + "px " + Math.round(ay - r.top) + "px");
  };

  /* ── 2) bóng mờ khi popup / hộp thoại bị gỡ ── */
  const ghost = (n: HTMLElement, parent: Node, next: Node | null) => {
    if (!CA.on || n.dataset.caGhost || document.hidden || !parent.isConnected) return;
    n.dataset.caGhost = "1"; n.removeAttribute("id"); n.removeAttribute("data-layer"); n.classList.add("ca-out"); n.setAttribute("aria-hidden", "true"); n.style.pointerEvents = "none";
    n.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"));
    n.querySelectorAll<HTMLElement>("[data-layer]").forEach((x) => x.removeAttribute("data-layer"));
    n.querySelectorAll<HTMLElement>("input,textarea,select,button").forEach((x) => { x.tabIndex = -1; x.blur(); });
    try { parent.insertBefore(n, next && next.parentNode === parent ? next : null); } catch { return; }
    let life = CA.T + 80;
    const fw = n.querySelector<HTMLElement>(".ca-fly");
    if (fw && fw.dataset.caFly) { const [x, y] = fw.dataset.caFly.split(",").map(Number); fly(fw, "close", x, y); life = CA.fly_out + 60; }
    let gone = false; const done = () => { if (gone) return; gone = true; n.remove(); };
    n.addEventListener("animationend", (e) => { if (e.target === n) done(); });
    setTimeout(done, life);
  };
  /* ── 4b) nút mở menu giữ .ca-open ── */
  const caFor = new WeakMap<HTMLElement, HTMLElement>();
  const clr = (p: HTMLElement) => { const el = caFor.get(p); if (el) { el.classList.remove("ca-open"); caFor.delete(p); } };
  /* ── 5) hộp thoại / sheet bung từ nút bấm ── */
  const flyIn = (n: HTMLElement) => {
    if (!CA.on) return;
    const w = n.querySelector<HTMLElement>(":scope>.modal,:scope>.sheet,:scope .sheet"); if (!w) return;
    const pt = srcPoint(w, null); if (!pt) return;
    w.classList.add("ca-fly"); w.dataset.caFly = pt.join(","); fly(w, "open", pt[0], pt[1]);
  };
  const layerMo = new MutationObserver((ms) => {
    for (const m of ms) {
      m.addedNodes.forEach((n) => {
        if (!isEl(n) || n.dataset.caGhost) return;
        if (cls(n, "pop")) {
          requestAnimationFrame(() => origin(n));
          if (src && Date.now() - src.t <= 1500 && src.el.isConnected && !n.contains(src.el)) { src.el.classList.add("ca-open"); caFor.set(n, src.el); }
        }
        if (cls(n, "overlay")) flyIn(n);
      });
      m.removedNodes.forEach((n) => {
        if (!isEl(n)) return;
        if (cls(n, "pop")) clr(n);
        if ((cls(n, "pop") || cls(n, "overlay")) && !n.dataset.caGhost) ghost(n, m.target, m.nextSibling);
      });
    }
  });
  const watched = new WeakSet<Element>();
  const watchHosts = () => {
    document.querySelectorAll<HTMLElement>(".hs-acc.hs-layer").forEach((h) => { if (watched.has(h)) return; watched.add(h); layerMo.observe(h, { childList: true }); if (!CA.on) h.classList.add("ca-off"); });
  };
  watchHosts();
  /* lớp nổi được LayerHost gắn thẳng vào body → theo dõi body để bắt host mới */
  const bodyMo = new MutationObserver(watchHosts);
  bodyMo.observe(document.body, { childList: true });
  offs.push(() => { layerMo.disconnect(); bodyMo.disconnect(); });

  /* ── 3) gạch chân tab trượt · 4c) nền trượt .ovsw ── */
  let prevTab: { l: number; w: number } | null = null, prevSw: { l: number; w: number } | null = null, raf = 0;
  const place = () => {
    const nav = root.querySelector<HTMLElement>("#tb .tabs"), a = nav && nav.querySelector<HTMLElement>(".tab.on");
    if (!nav) { prevTab = null; return; }
    let ind = nav.querySelector<HTMLElement>(":scope>.ca-ind");
    if (!a) { if (ind) ind.remove(); if (cls(nav, "ca")) nav.classList.remove("ca"); return; }
    if (!ind) { ind = document.createElement("i"); ind.className = "ca-ind"; ind.setAttribute("aria-hidden", "true"); nav.appendChild(ind); }
    if (!cls(nav, "ca")) nav.classList.add("ca");
    const l = a.offsetLeft + 8, w = Math.max(8, a.offsetWidth - 16);
    ind.style.width = w + "px"; ind.style.transform = "translateX(" + l + "px)";
    if (prevTab && CA.on && (prevTab.l !== l || prevTab.w !== w)) {
      const dx = prevTab.l - l, sx = prevTab.w / w;
      ind.animate([{ transform: "translateX(" + l + "px) translateX(" + dx + "px) scaleX(" + sx + ")" }, { transform: "translateX(" + l + "px)" }], { duration: CA.slide, easing: CA.ease });
    }
    prevTab = { l, w };
  };
  const runSw = () => {
    const sw = root.querySelector<HTMLElement>("#bar .ovsw"); if (!sw) { prevSw = null; return; }
    const a = sw.querySelector<HTMLElement>(":scope>button.on"); if (!a) return;
    let th = sw.querySelector<HTMLElement>(":scope>.ca-thumb");
    if (!th) { th = document.createElement("i"); th.className = "ca-thumb"; th.setAttribute("aria-hidden", "true"); sw.prepend(th); }
    if (!cls(sw, "ca")) sw.classList.add("ca");
    const l = a.offsetLeft, w = a.offsetWidth; th.style.width = w + "px"; th.style.transform = "translateX(" + l + "px)";
    if (prevSw && prevSw.l !== l && CA.on) th.animate([{ transform: "translateX(" + prevSw.l + "px)" }, { transform: "translateX(" + l + "px)" }], { duration: CA.slide - 40, easing: CA.ease });
    prevSw = { l, w };
  };
  const schedule = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; place(); runSw(); }); };
  /* React không dựng lại #tb/#bar mỗi lần đổi tab (chỉ đổi class) → theo dõi cả thuộc tính class trong khung app */
  const rootMo = new MutationObserver((ms) => {
    for (const m of ms) {
      const t = m.target as HTMLElement;
      if (m.type === "attributes" && (cls(t, "ca-ind") || cls(t, "ca-thumb") || cls(t, "ca-open"))) continue;
      if (t.closest?.("#tb, #bar") || (m.type === "childList" && (t === root || t.id === "app"))) { schedule(); return; }
    }
  });
  rootMo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  const onResize = () => { prevTab = null; prevSw = null; schedule(); };
  window.addEventListener("resize", onResize);
  schedule();
  offs.push(() => { rootMo.disconnect(); window.removeEventListener("resize", onResize); if (raf) cancelAnimationFrame(raf); });

  return () => { for (const f of offs) f(); };
}
