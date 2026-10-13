"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { INBOX_CONVERSATION_EVENT, INBOX_MESSAGE_EVENT } from "./inbox-live-events";

export function InboxAutoRefresh({ workspaceId }: { workspaceId: string | null }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(false);
  function refresh() {
    setRefreshing(true);
    router.refresh();
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
        if (document.visibilityState === "visible") router.refresh();
      })
      .subscribe((status) => { subscribed = status === "SUBSCRIBED"; setLive(subscribed); });
    const onVisible = () => { if (document.visibilityState === "visible" && !subscribed) router.refresh(); };
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
  }, [router, workspaceId]);
  return <button type="button" onClick={refresh} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs font-semibold text-slate-600 disabled:opacity-60"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />{live ? "Trực tiếp · Làm mới" : "Làm mới"}</button>;
}
