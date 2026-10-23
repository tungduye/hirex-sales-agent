"use client";

// Mục "Tiện ích" của HireX: tab Cuộc họp (Meeting Hub) · tab Kiểm thử phần mềm (moduleHS/qa: agent tự test web, báo cáo).
// Giao diện Cuộc họp là code gốc (meeting-ui.js) vẽ vào khung .hs-rec; Kiểm thử (qa-ui.js) vẽ vào .hs-rec.hs-qa. Chỉ nạp ở trình duyệt.
import { useEffect, useRef, useState } from "react";
import { FlaskConical, Mic } from "lucide-react";

type Boot = Record<string, unknown>;
declare global { interface Window { __HS_REC_BOOT?: Boot } }
type UiModule = { mount: (root: HTMLElement, boot?: Boot) => () => void };

/** Nạp giao diện gốc (JS + CSS) qua /api/hs/qa?action=asset&v=<phiên bản> thay vì gói của Next: Cloudflare / trình duyệt giữ file JS
 *  của Next tới 4 giờ nên sửa xong người dùng vẫn thấy bản cũ. Link có số phiên bản (giờ sửa file) → sửa là thấy ngay, không sửa thì dùng bộ nhớ đệm. */
let VER: Promise<string> | null = null;
const ver = () => (VER ??= fetch("/api/hs/qa?action=ver", { cache: "no-store" }).then((r) => r.json()).then((j: { v?: string }) => j.v || String(Date.now())).catch(() => String(Date.now())));
async function loadUi(js: "qa.js" | "meeting.js", css: "qa.css" | "meeting.css"): Promise<UiModule> {
  const v = await ver(), href = `/api/hs/qa?action=asset&f=${css}&v=${v}`;
  let link = document.querySelector<HTMLLinkElement>(`link[data-hs-ui="${css}"]`);
  if (!link) { link = document.createElement("link"); link.rel = "stylesheet"; link.dataset.hsUi = css; document.head.append(link); }
  if (link.getAttribute("href") !== href) link.href = href;
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `/api/hs/qa?action=asset&f=${js}&v=${v}`) as Promise<UiModule>;
}

function MeetingRoot({ boot }: { boot: Boot }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true, off: (() => void) | undefined;
    window.__HS_REC_BOOT = boot;
    void loadUi("meeting.js", "meeting.css").then((ui) => { if (alive && ref.current) off = ui.mount(ref.current, boot); });
    return () => { alive = false; off?.(); };
  }, [boot]);
  return <div ref={ref} className="hs-rec" />;
}

function QaRoot() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true, off: (() => void) | undefined;
    void loadUi("qa.js", "qa.css").then((ui) => { if (alive && ref.current) off = ui.mount(ref.current); });
    return () => { alive = false; off?.(); };
  }, []);
  return <div ref={ref} className="hs-rec hs-qa h-full" />;
}

const TABS = [
  { id: "meeting", label: "Cuộc họp", icon: Mic },
  { id: "testing", label: "Kiểm thử phần mềm", icon: FlaskConical },
] as const;

export function UtilitiesApp({ boot }: { boot: Boot }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("meeting");
  const [qa, setQa] = useState(false);   // mở tab Kiểm thử lần đầu mới nạp; sau đó giữ (đang test vẫn theo dõi)
  const pick = (id: typeof tab) => {
    setTab(id); if (id === "testing") setQa(true);
    // Sóng âm vẽ theo kích thước khung: đo lại khi tab Cuộc họp hiện ra.
    if (id === "meeting") requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-end gap-1 border-b border-slate-200 bg-white px-4" role="tablist" aria-label="Tiện ích">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => pick(id)}
            className={`-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium ${tab === id ? "border-red-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            <Icon className="size-4" />{label}
          </button>
        ))}
      </div>
      {/* Tab Cuộc họp giữ nguyên khi sang tab khác (đang ghi âm vẫn chạy). */}
      <div className="min-h-0 flex-1" hidden={tab !== "meeting"}><MeetingRoot boot={boot} /></div>
      {qa ? <div className="min-h-0 flex-1" hidden={tab !== "testing"}><QaRoot /></div> : null}
    </div>
  );
}

/** Trang xem công khai /m/<slug>[/<loại>] (link gửi qua Zalo, không cần đăng nhập). */
export function MeetingPublic({ slug, kind }: { slug: string; kind: string }) {
  const [boot] = useState<Boot>(() => ({ pub: { slug, kind } }));
  return <div className="h-dvh"><MeetingRoot boot={boot} /></div>;
}
