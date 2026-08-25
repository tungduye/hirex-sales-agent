"use client";

import { useActionState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncLatestGmailMessages } from "@/modules/integrations/gmail/server/sync-latest-messages";
import { initialGmailSyncState } from "@/modules/integrations/gmail/types/sync-state";

export function SyncLatestMessagesButton({ emailAccountId }: { emailAccountId: string }) {
  const [state, action, pending] = useActionState(syncLatestGmailMessages, initialGmailSyncState);
  return (
    <div className="sm:text-right">
      <form action={action}>
        <input type="hidden" name="emailAccountId" value={emailAccountId} />
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {pending ? "Syncing..." : "Sync latest 10"}
        </Button>
      </form>
      {state.message && <p className={`mt-1.5 max-w-56 text-xs ${state.success ? "text-emerald-600" : "text-rose-600"}`} role={state.success ? "status" : "alert"}>{state.message}</p>}
    </div>
  );
}
