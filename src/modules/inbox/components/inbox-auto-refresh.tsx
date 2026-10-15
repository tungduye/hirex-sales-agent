"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { INBOX_CONVERSATION_EVENT, INBOX_MESSAGE_EVENT } from "./inbox-live-events";
import { INBOX_REFRESH_EVENT } from "./inbox-refresh-event";

/** Re-renders the open conversation and reloads the list kept in the inbox layout. */
function useRefreshAll() {
  const router = useRouter();
  return useCallback(() => { router.refresh(); window.dispatchEvent(new Event(INBOX_REFRESH_EVENT)); }, [router]);
}

export function InboxAutoRefresh({ workspaceId, compact = false }: { workspaceId: string | null; compact?: boolean }) {
  const refreshAll = useRefreshAll();
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  function refresh() {
    setRefreshing(true);
    refreshAll();
    window.setTimeout(() => setRefreshing(false), 700);
  }
  useEffect(() => {
    if (!workspaceId) return;
    const client = createClient();
    let subscribed = false;
    const channel = client.channel(`inbox:${workspaceId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "omnichannel_messages", filter: `workspace_id=eq.${workspaceId}` }, (payload) => {
        window.dispatchEvent(new CustomEvent(INBOX_MESSAGE_EVENT, { detail: payload.new }));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "omnichannel_conversations", filter: `workspace_id=eq.${workspaceId}` }, (payload) => {
        window.dispatchEvent(new CustomEvent(INBOX_CONVERSATION_EVENT, { detail: payload.new }));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "omnichannel_conversations", filter: `workspace_id=eq.${workspaceId}` }, () => {
        // A new conversation needs account/contact metadata that is not present in
        // the realtime row. This rare event is the only normal full refresh.
        if (document.visibilityState === "visible") refreshAll();
      })
      .subscribe((status) => { subscribed = status === "SUBSCRIBED"; setLive(subscribed); });
    const onVisible = () => { if (document.visibilityState === "visible" && !subscribed) refreshAll(); };
    // Reconcile the view even when the browser's realtime websocket drops.
    // Realtime is the primary path. Polling is only a slower safety net so it
    // does not repeatedly rerender the whole server page while the user chats.
    const pollTimer = setInterval(onVisible, 30_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      void client.removeChannel(channel);
    };
  }, [refreshAll, workspaceId]);
  if (compact) return <button type="button" onClick={refresh} disabled={refreshing} title="Bấm để làm mới danh sách" className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-60 ${live ? "text-emerald-700" : "text-slate-500"}`}>{refreshing ? <RefreshCw className="size-3 animate-spin"/> : <span className={`size-[7px] rounded-full ${live ? "bg-emerald-500" : "bg-slate-300"}`}/>}{live ? "Trực tiếp" : "Làm mới"}</button>;
  return <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-60"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />{live ? "Trực tiếp · Làm mới" : "Làm mới"}</button>;
}
