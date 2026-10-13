"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from "react";
import type { OmnichannelInboxMessage } from "../types/omnichannel-inbox";
import { INBOX_OLDER_MESSAGES_EVENT } from "./inbox-live-events";

const BOTTOM_THRESHOLD_PX = 96;

export function ConversationMessageScroll(props: {
  conversationId: string;
  latestMessageId: string | null;
  children: ReactNode;
  className?: string;
  onReachTop?: () => Promise<void>;
  hasOlder?: boolean;
  loadingOlder?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const previousConversationIdRef = useRef<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasHistory, setHasHistory] = useState(true);
  const historyCursorRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const conversationChanged = previousConversationIdRef.current !== props.conversationId;
    if (conversationChanged || isNearBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
      isNearBottomRef.current = true;
    }
    previousConversationIdRef.current = props.conversationId;
  }, [props.conversationId, props.latestMessageId]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [props.conversationId]);

  async function handleScroll(event: UIEvent<HTMLDivElement>) {
    const viewport = event.currentTarget;
    isNearBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= BOTTOM_THRESHOLD_PX;
    if (viewport.scrollTop < 80 && props.hasOlder && !props.loadingOlder && props.onReachTop) {
      const previousHeight = viewport.scrollHeight;
      await props.onReachTop();
      requestAnimationFrame(() => { viewport.scrollTop += viewport.scrollHeight - previousHeight; });
    }
    if (viewport.scrollTop < 80 && hasHistory && !loadingHistory && props.latestMessageId) {
      const previousHeight = viewport.scrollHeight;
      setLoadingHistory(true);
      try {
        const query = new URLSearchParams(historyCursorRef.current ? { before: historyCursorRef.current } : { anchor: props.latestMessageId });
        const response = await fetch(`/api/inbox/conversations/${props.conversationId}/messages?${query}`, { cache: "no-store" });
        if (!response.ok) throw new Error("LOAD_FAILED");
        const payload = await response.json() as { messages: OmnichannelInboxMessage[]; hasMore: boolean; nextBefore: string | null };
        historyCursorRef.current = payload.nextBefore;
        setHasHistory(payload.hasMore && Boolean(payload.nextBefore));
        window.dispatchEvent(new CustomEvent(INBOX_OLDER_MESSAGES_EVENT, { detail: { conversationId: props.conversationId, messages: payload.messages } }));
        requestAnimationFrame(() => { viewport.scrollTop += viewport.scrollHeight - previousHeight; });
      } finally { setLoadingHistory(false); }
    }
  }

  return (
    <div ref={viewportRef} onScroll={handleScroll} className={props.className}>
      <div ref={contentRef} className="space-y-2.5">
        {props.loadingOlder || loadingHistory ? <p className="py-2 text-center text-xs text-slate-400">Đang tải tin cũ hơn…</p> : null}
        {props.children}
      </div>
    </div>
  );
}
