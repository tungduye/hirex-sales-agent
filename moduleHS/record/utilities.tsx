"use client";

// Mục "Tiện ích" của HireX: tab Cuộc họp (Meeting Hub) · tab Kiểm thử phần mềm (chưa có nội dung).
// Giao diện Cuộc họp là code gốc (meeting-ui.js) vẽ vào khung .hs-rec; chỉ nạp ở trình duyệt.
import "./meeting.css";
import { useEffect, useRef, useState } from "react";
import { FlaskConical, Mic } from "lucide-react";

type Boot = Record<string, unknown>;
declare global { interface Window { __HS_REC_BOOT?: Boot } }

function MeetingRoot({ boot }: { boot: Boot }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true, off: (() => void) | undefined;
    window.__HS_REC_BOOT = boot;
    void import("./meeting-ui.js").then((ui) => { if (alive && ref.current) off = ui.mount(ref.current, boot); });
    return () => { alive = false; off?.(); };
  }, [boot]);
  return <div ref={ref} className="hs-rec" />;
}

const TABS = [
  { id: "meeting", label: "Cuộc họp", icon: Mic },
  { id: "testing", label: "Kiểm thử phần mềm", icon: FlaskConical },
] as const;

export function UtilitiesApp({ boot }: { boot: Boot }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("meeting");
  const pick = (id: typeof tab) => {
    setTab(id);
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
      {tab === "testing" ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-slate-400">
          <FlaskConical className="size-8" />
          <span className="text-sm">Kiểm thử phần mềm — chưa có nội dung</span>
        </div>
      ) : null}
    </div>
  );
}

/** Trang xem công khai /m/<slug>[/<loại>] (link gửi qua Zalo, không cần đăng nhập). */
export function MeetingPublic({ slug, kind }: { slug: string; kind: string }) {
  const [boot] = useState<Boot>(() => ({ pub: { slug, kind } }));
  return <div className="h-dvh"><MeetingRoot boot={boot} /></div>;
}
