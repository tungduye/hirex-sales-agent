"use client";

import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

// Common emoji (as in Zalo's quick list); they are plain text, so every channel can send them.
export const EMOJI = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤗", "🤔", "😅", "😉", "🙂", "😇", "🥰", "😴",
  "😢", "😭", "😡", "😱", "😬", "🙄", "😮", "🥲", "👍", "👎", "👏", "🙏", "👌", "✌️", "💪", "🤝",
  "❤️", "💯", "🔥", "🎉", "✅", "❌", "⭐", "💼", "📌", "📎", "📞", "⏰", "🚀", "🌹",
];

export function EmojiPicker({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={boxRef} className="relative">
    <button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} aria-expanded={open} title="Biểu tượng cảm xúc"
      className={`inline-flex min-h-[34px] items-center rounded-lg px-2 text-[13px] font-semibold disabled:opacity-60 ${open ? "bg-slate-100 text-slate-900" : "text-slate-700 hover:bg-slate-100"}`}>
      <Smile className="size-[17px]"/><span className="sr-only">Biểu tượng cảm xúc</span></button>
    {open ? <div role="dialog" aria-label="Chọn biểu tượng cảm xúc" className="absolute bottom-10 left-0 z-30 grid w-[296px] grid-cols-8 gap-0.5 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      {EMOJI.map((emoji) => <button key={emoji} type="button" onClick={() => onPick(emoji)} className="flex size-8 items-center justify-center rounded-lg text-lg hover:bg-slate-100" aria-label={`Chèn ${emoji}`}>{emoji}</button>)}
    </div> : null}
  </div>;
}
