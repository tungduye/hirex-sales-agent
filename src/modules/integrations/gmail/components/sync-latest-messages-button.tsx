"use client";

import { useActionState, useEffect, useRef, type FormEvent } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncLatestGmailMessages } from "@/modules/integrations/gmail/server/sync-latest-messages";
import { initialGmailSyncState } from "@/modules/integrations/gmail/types/sync-state";

export function SyncLatestMessagesButton({ emailAccountId, disabled = false, onPendingChange, onBeforeSubmit, onComplete }: { emailAccountId: string; disabled?: boolean; onPendingChange?: (pending: boolean) => void; onBeforeSubmit?: () => boolean; onComplete?: () => void }) {
  const [state, action, pending] = useActionState(syncLatestGmailMessages, initialGmailSyncState);
  const lockAcquired = useRef(false);
  const observedPending = useRef(false);
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  useEffect(() => {
    if (pending) {
      observedPending.current = true;
      return;
    }
    if (!observedPending.current || !lockAcquired.current) return;
    observedPending.current = false;
    lockAcquired.current = false;
    onComplete?.();
  }, [onComplete, pending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (onBeforeSubmit && !onBeforeSubmit()) {
      event.preventDefault();
      return;
    }
    lockAcquired.current = true;
    onPendingChange?.(true);
  }
  return (
    <div className="sm:text-right">
      <form action={action} onSubmit={handleSubmit}>
        <input type="hidden" name="emailAccountId" value={emailAccountId} />
        <Button type="submit" variant="outline" size="sm" disabled={pending || disabled}>
          {pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {pending ? "Syncing..." : "Test sync latest 10"}
        </Button>
      </form>
      {state.message && <p className={`mt-1.5 max-w-56 text-xs ${state.success ? "text-emerald-600" : "text-rose-600"}`} role={state.success ? "status" : "alert"}>{state.message}</p>}
    </div>
  );
}
