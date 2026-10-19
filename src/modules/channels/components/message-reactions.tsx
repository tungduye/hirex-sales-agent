"use client";

import { useState, useTransition } from "react";
import { SmilePlus } from "lucide-react";
import { reactToZaloMessage } from "../server/reaction-actions";
import { QUICK_REACTIONS, withMyReaction, type MessageReaction, type QuickReactionIcon } from "../core/zalo-reactions";

/** Reactions under a Zalo message, and the six quick reactions to add one (like Zalo's long-press bar). */
export function MessageReactions(props: { conversationId: string; providerMessageId: string; reactions: MessageReaction[]; canReact: boolean; outbound: boolean }) {
  const [reactions, setReactions] = useState(props.reactions);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (reactions.length === 0 && !props.canReact) return null;
  const react = (icon: QuickReactionIcon, emoji: string) => {
    setOpen(false); setError(null);
    startTransition(async () => {
      const result = await reactToZaloMessage({ conversationId: props.conversationId, providerMessageId: props.providerMessageId, icon });
      if (result.ok) setReactions((current) => withMyReaction(current, emoji)); else setError(result.message ?? "Không thể thả cảm xúc.");
    });
  };
  const chip = props.outbound ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700";
  // Like Zalo: the add button appears when the pointer is on the message (or it has keyboard focus).
  const button = props.canReact ? <button type="button" aria-label="Thả cảm xúc" aria-expanded={open} disabled={pending} onClick={() => setOpen((value) => !value)}
    className={`inline-flex size-6 items-center justify-center rounded-full transition ${open ? "opacity-100" : "opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100"} ${reactions.length ? (props.outbound ? "text-white hover:bg-white/20" : "text-slate-500 hover:bg-slate-100") : "bg-white text-slate-500 shadow ring-1 ring-slate-200 hover:text-slate-700"}`}>
    <SmilePlus className="size-3.5"/></button> : null;
  const menu = open ? <div role="menu" className={`absolute bottom-full z-20 mb-1 flex gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-1 shadow-lg ${props.outbound ? "right-0" : "left-0"}`}
    onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
    {QUICK_REACTIONS.map((item) => <button key={item.icon} type="button" role="menuitem" title={item.label} aria-label={item.label}
      onClick={() => react(item.icon, item.emoji)} className="rounded-full p-1 text-lg leading-none transition hover:scale-125 hover:bg-slate-100">{item.emoji}</button>)}
  </div> : null;
  const alert = error ? <span role="alert" className={`text-[10px] ${props.outbound ? "text-white" : "text-red-600"}`}>{error}</span> : null;
  // No reactions yet: the button sits beside the bubble, so the message keeps its normal height.
  if (reactions.length === 0) return <div className={`absolute top-1/2 -translate-y-1/2 ${props.outbound ? "-left-8" : "-right-8"}`}>
    {button}{menu}{alert ? <div className="absolute top-full mt-1 w-48">{alert}</div> : null}</div>;
  return <div className="relative mt-1.5 flex flex-wrap items-center gap-1">
    {reactions.map((item) => <span key={item.emoji} title={item.mine ? "Có cảm xúc của nick này" : undefined}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] leading-none ${chip} ${item.mine ? "ring-1 ring-amber-300" : ""}`}>
      <span>{item.emoji}</span>{item.count > 1 ? <span className="tabular-nums">{item.count}</span> : null}</span>)}
    {button}{menu}{alert}
  </div>;
}
