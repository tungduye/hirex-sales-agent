"use client";

// Phím tắt toàn cục của AccountsHS — port các handler keydown trong v7.py (5184-5193, 5780-5782, 5811, 5860).
// Esc của lớp nổi (pop/menu/modal/sheet) do ui-kit tự xử lý; ở đây chỉ bỏ focus dòng / bỏ chọn khi không còn lớp nổi.
import { isTbl } from "../core/model";
import { S, emit, navGo, store } from "./store";
import { delAccs, selectAllView } from "./table";
import { openFlt } from "./table-filter";
import { openDetail } from "./detail";

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
/** có lớp nổi (modal/sheet/confirm) đang mở trong LayerHost */
const overlayOpen = () => !!q(".hs-layer .overlay");
const popOpen = () => !!q(".hs-layer .pop");

export function installShortcuts(): () => void {
  const kd = (e: KeyboardEvent) => {
    const tg = e.target instanceof HTMLElement ? e.target : null;
    const typing = !!tg && (/INPUT|TEXTAREA|SELECT/.test(tg.tagName) || tg.isContentEditable);
    // Ctrl+Enter trong modal: bấm nút chính (.pri) ở chân modal (không áp khi đang có hộp xác nhận)
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && q(".hs-layer .modal") && !q(".hs-layer .overlay.top")) {
      const b = q<HTMLButtonElement>(".hs-layer .modal footer .btn.pri:not(:disabled)");
      if (b) { e.preventDefault(); b.click(); return; }
    }
    // Ctrl+K: mở bộ lọc
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && isTbl(S) && !overlayOpen()) {
      e.preventDefault(); const b = q("#bar [data-a=flt]"); if (b) openFlt(b); return;
    }
    // Enter trên dòng đang focus → chi tiết
    if (e.key === "Enter" && tg && tg.matches("#tw tbody tr[data-id]")) { e.preventDefault(); openDetail(+(tg.dataset.id || 0)); return; }
    if (e.key === "Escape") {
      if (e.defaultPrevented || popOpen() || overlayOpen()) return;
      if (S.focus != null) { S.focus = null; emit(); } else if (S.sel.size) { S.sel.clear(); emit(); }
      return;
    }
    if (typing) return;
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); navGo(-1, q("#tw")?.scrollTop); return; }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); navGo(1, q("#tw")?.scrollTop); return; }
    if (!isTbl(S) || overlayOpen()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") { e.preventDefault(); selectAllView(); }
    else if (e.key === "/") { e.preventDefault(); q<HTMLInputElement>("#q")?.focus(); }
    else if (e.key === "Delete" && S.sel.size && store.canEdit) void delAccs([...S.sel]);
  };
  document.addEventListener("keydown", kd);
  return () => document.removeEventListener("keydown", kd);
}
