"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OmnichannelInboxView } from "./omnichannel-inbox-view";
import type { OmnichannelInboxData } from "../types/omnichannel-inbox";

import { INBOX_REFRESH_EVENT } from "./inbox-refresh-event";

/**
 * Hồ Chứa frame. The conversation list lives here (in the layout) and is loaded from the browser, so
 * opening another conversation only loads that conversation instead of rebuilding the whole list.
 */
export function InboxShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const selectedConversationId = /^\/inbox\/all\/([0-9a-f-]{36})/iu.exec(pathname)?.[1] ?? null;
  const [data, setData] = useState<OmnichannelInboxData | null>(null);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const latestRequest = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  const load = useCallback(async (nextQuery: string) => {
    const requestId = ++latestRequest.current;
    try {
      const response = await fetch(`/api/inbox/view${nextQuery ? `?${nextQuery}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("LOAD_FAILED");
      const payload = await response.json() as OmnichannelInboxData;
      if (requestId !== latestRequest.current) return; // a newer filter won
      setData(payload); setLoadedQuery(nextQuery); setFailed(false);
    } catch {
      if (requestId === latestRequest.current) setFailed(true);
    }
  }, []);

  useEffect(() => { void load(query); }, [query, load]);
  useEffect(() => {
    const onRefresh = () => void load(queryRef.current);
    window.addEventListener(INBOX_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(INBOX_REFRESH_EVENT, onRefresh);
  }, [load]);

  if (!data) return <div className="flex h-[calc(100dvh-4rem)] min-h-[520px] overflow-hidden bg-white">
    <aside className={`${selectedConversationId ? "hidden lg:flex" : "flex"} w-full shrink-0 flex-col border-r border-slate-200 lg:w-[340px]`} aria-busy="true" aria-label="Đang tải danh sách hội thoại">
      <div className="space-y-2.5 border-b border-slate-100 p-3.5"><p className="text-lg font-bold text-slate-950">Hồ Chứa</p><div className="h-9 animate-pulse rounded-lg bg-slate-100"/><div className="h-8 animate-pulse rounded-lg bg-slate-100"/></div>
      {failed ? <div className="m-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Chưa tải được danh sách. <button type="button" onClick={() => void load(query)} className="font-semibold underline">Thử lại</button></div>
        : <div className="space-y-2 p-3">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-14 animate-pulse rounded-xl bg-slate-100"/>)}</div>}
    </aside>
    <main className={`${selectedConversationId ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50`}>{children}</main>
  </div>;

  return <OmnichannelInboxView {...data} selectedConversationId={selectedConversationId} listLoading={loadedQuery !== query} detail={children}/>;
}
