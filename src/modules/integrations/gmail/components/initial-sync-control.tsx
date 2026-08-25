"use client";

import { useActionState } from "react";
import { CheckCircle2, Database, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runInitialSyncBatchAction } from "@/modules/integrations/gmail/server/run-initial-sync-action";
import { initialSyncActionState, type InitialSyncProgress } from "@/modules/integrations/gmail/types/initial-sync";

export function InitialSyncControl({ emailAccountId, progress }: { emailAccountId: string; progress: InitialSyncProgress | null }) {
  const [state, action, pending] = useActionState(runInitialSyncBatchAction, initialSyncActionState);
  const completed = progress?.status === "COMPLETED" || state.completed;
  const label = progress ? progress.status === "FAILED" ? "Resume sync" : "Continue sync" : "Start mailbox sync";
  return (
    <div className="mt-4 rounded-lg border bg-slate-50 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 ring-1 ring-slate-200">{completed ? <CheckCircle2 className="size-4" /> : <Database className="size-4" />}</div>
          <div><p className="text-xs font-bold text-slate-800">Initial sync</p><p className="mt-0.5 text-[11px] text-slate-500">One batch per click · up to 50 messages</p></div>
        </div>
        <div className="grid grid-cols-4 gap-3 text-center text-[11px]">
          <Metric label="Processed" value={progress?.processedMessages ?? 0} />
          <Metric label="Synced" value={progress?.syncedMessages ?? 0} />
          <Metric label="Skipped" value={progress?.skippedMessages ?? 0} />
          <Metric label="Failed" value={progress?.failedMessages ?? 0} />
        </div>
        <div className="min-w-36 lg:text-right"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{progress?.status ?? "NOT STARTED"}</p>{completed ? <span className="text-xs font-semibold text-emerald-700">Mailbox indexed</span> : <form action={action}><input type="hidden" name="emailAccountId" value={emailAccountId} /><Button type="submit" size="sm" disabled={pending}>{pending && <LoaderCircle className="size-3.5 animate-spin" />}{pending ? "Processing batch..." : label}</Button></form>}</div>
      </div>
      {state.message && <p className={`mt-2 text-xs ${state.success ? "text-emerald-700" : "text-rose-600"}`} role={state.success ? "status" : "alert"}>{state.message}</p>}
      {progress?.safeErrorCode && progress.status === "FAILED" && <p className="mt-2 text-xs text-amber-700">The previous batch stopped safely. Resume to retry the saved checkpoint.</p>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div><p className="font-bold text-slate-800">{value}</p><p className="text-slate-400">{label}</p></div>; }
