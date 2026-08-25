"use client";

import { useActionState, useEffect, useRef, type FormEvent } from "react";
import { History, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runIncrementalSyncBatchAction } from "@/modules/integrations/gmail/server/run-incremental-sync-action";
import { initialIncrementalSyncActionState, type IncrementalSyncProgress } from "@/modules/integrations/gmail/types/incremental-sync";

interface Props {
  emailAccountId: string;
  progress: IncrementalSyncProgress | null;
  globallyBusy: boolean;
  blockedByOtherAccount: boolean;
  acquireGlobalLock: (emailAccountId: string) => boolean;
  releaseGlobalLock: (emailAccountId: string) => void;
}

export function IncrementalSyncControl({ emailAccountId, progress, globallyBusy, blockedByOtherAccount, acquireGlobalLock, releaseGlobalLock }: Props) {
  const [state, action, pending] = useActionState(runIncrementalSyncBatchAction, initialIncrementalSyncActionState);
  const lockAcquired = useRef(false);
  const observedPending = useRef(false);
  useEffect(() => {
    if (pending) {
      observedPending.current = true;
      return;
    }
    if (!observedPending.current || !lockAcquired.current) return;
    observedPending.current = false;
    lockAcquired.current = false;
    releaseGlobalLock(emailAccountId);
  }, [emailAccountId, pending, releaseGlobalLock]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!acquireGlobalLock(emailAccountId)) {
      event.preventDefault();
      return;
    }
    lockAcquired.current = true;
  }

  const displayed = state.progress ?? progress;
  const historyExpired = displayed?.safeErrorCode === "HISTORY_ID_EXPIRED";
  return (
    <div className="mt-3 rounded-lg border bg-slate-50 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 ring-1 ring-slate-200"><History className="size-4" /></div>
          <div><p className="text-xs font-bold text-slate-800">Incremental sync</p><p className="mt-0.5 text-[11px] text-slate-500">One Gmail History page per action · manual only</p></div>
        </div>
        <div className="grid grid-cols-5 gap-3 text-center text-[11px]">
          <Metric label="History" value={displayed?.processedHistoryRecords ?? 0} />
          <Metric label="Affected" value={displayed?.affectedMessageCount ?? 0} />
          <Metric label="Synced" value={displayed?.syncedMessageCount ?? 0} />
          <Metric label="Deleted" value={displayed?.deletedMessageCount ?? 0} />
          <Metric label="Failed" value={displayed?.failedMessageCount ?? 0} />
        </div>
        <form action={action} onSubmit={handleSubmit} className="lg:text-right">
          <input type="hidden" name="emailAccountId" value={emailAccountId} />
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{pending ? "Processing one page..." : displayed?.status ?? "READY"}</p>
          <Button type="submit" size="sm" disabled={pending || globallyBusy || historyExpired}>
            {pending && <LoaderCircle className="size-3.5 animate-spin" />}
            {pending ? "Syncing changes..." : "Sync changes once"}
          </Button>
        </form>
      </div>
      {blockedByOtherAccount && <p className="mt-2 text-xs text-slate-500">Another Gmail account is currently syncing.</p>}
      {historyExpired && <p className="mt-2 text-xs text-amber-700" role="alert">Gmail history expired. A reviewed full mailbox resync is required before incremental sync can continue.</p>}
      {state.message && <p className={`mt-2 text-xs ${state.success ? "text-emerald-700" : "text-rose-600"}`} role={state.success ? "status" : "alert"}>{state.message}</p>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div><p className="font-bold text-slate-800">{value}</p><p className="text-slate-400">{label}</p></div>;
}
