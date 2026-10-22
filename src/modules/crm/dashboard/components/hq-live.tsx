"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

// The moving parts of HireX HQ: the clock, the countdown to the next meeting, numbers that count up,
// and a quiet refresh every minute so the screen stays live without reloading the page.

const pad = (value: number) => String(value).padStart(2, "0");
const vnClock = (date: Date) => {
  const parts = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "long", day: "2-digit", month: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = get("weekday");
  return `${get("hour")}:${get("minute")}:${get("second")} · ${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${get("day")}/${get("month")}`;
};

// One shared second ticker (null on the server, so the first paint has no clock mismatch).
const subscribeSecond = (notify: () => void) => { const timer = window.setInterval(notify, 1000); return () => window.clearInterval(timer); };
const secondNow = () => Math.floor(Date.now() / 1000) * 1000;
const serverNow = () => null;

function useNow() {
  return useSyncExternalStore<number | null>(subscribeSecond, secondNow, serverNow);
}

export function HqClock({ className }: { className?: string }) {
  const now = useNow();
  return <span className={className}>{now === null ? "--:--:--" : vnClock(new Date(now))}</span>;
}

export function HqCountdown({ at, className }: { at: string; className?: string }) {
  const now = useNow();
  if (now === null) return <b className={className}>--:--:--</b>;
  const left = Math.max(0, Math.floor((Date.parse(at) - now) / 1000));
  return <b className={className}>{`${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`}</b>;
}

/** A number that glides to its new value after each refresh. */
export function HqCount({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (from.current === value) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const start = performance.now(), begin = from.current, duration = still ? 0 : 900;
    let frame = 0;
    const step = (time: number) => {
      const progress = duration ? Math.min(1, (time - start) / duration) : 1;
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(begin + (value - begin) * eased));
      if (progress < 1) frame = requestAnimationFrame(step); else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className={className}>{shown.toLocaleString("vi-VN")}</span>;
}

/** Re-reads the page data every minute while the tab is visible. */
export function HqAutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}
