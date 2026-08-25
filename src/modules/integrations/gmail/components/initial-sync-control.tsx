"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Database, LoaderCircle, OctagonX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyncLatestMessagesButton } from "@/modules/integrations/gmail/components/sync-latest-messages-button";
import { runInitialSyncBatchAction } from "@/modules/integrations/gmail/server/run-initial-sync-action";
import { initialSyncActionState, type InitialSyncActionState, type InitialSyncProgress } from "@/modules/integrations/gmail/types/initial-sync";

// Bounded automatic sync cap.
export const MAX_AUTO_BATCHES = 10;

type RunMode = "idle" | "manual" | "automatic";

interface Props {
  emailAccountId: string;
  progress: InitialSyncProgress | null;
  globallyBusy: boolean;
  blockedByOtherAccount: boolean;
  acquireGlobalLock: (emailAccountId: string) => boolean;
  releaseGlobalLock: (emailAccountId: string) => void;
}

export function InitialSyncControl({ emailAccountId, progress, globallyBusy, blockedByOtherAccount, acquireGlobalLock, releaseGlobalLock }: Props) {
  const router = useRouter();
  const mounted = useRef(true);
  const stopRequested = useRef(false);
  const running = useRef(false);
  const [mode, setMode] = useState<RunMode>("idle");
  const [batchNumber, setBatchNumber] = useState(0);
  const [testPending, setTestPending] = useState(false);
  const [localProgress, setLocalProgress] = useState(progress);
  const [result, setResult] = useState<InitialSyncActionState>(initialSyncActionState);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopRequested.current = true; };
  }, []);

  const invokeBatch = useCallback(async () => {
    const formData = new FormData();
    formData.set("emailAccountId", emailAccountId);
    return runInitialSyncBatchAction(initialSyncActionState, formData);
  }, [emailAccountId]);

  const applyResult = useCallback((next: InitialSyncActionState) => {
    if (!mounted.current) return;
    setResult(next);
    if (next.progress) setLocalProgress(next.progress);
    router.refresh();
  }, [router]);

  async function runManualBatch() {
    if (running.current || testPending || !acquireGlobalLock(emailAccountId)) return;
    running.current = true;
    setMode("manual");
    setBatchNumber(1);
    try { applyResult(await invokeBatch()); }
    catch { applyResult({ success: false, completed: false, message: "The sync request could not be completed. Please try again." }); }
    finally {
      releaseGlobalLock(emailAccountId);
      if (mounted.current) { running.current = false; setMode("idle"); setBatchNumber(0); }
    }
  }

  async function runAutomatically() {
    if (running.current || testPending || localProgress?.status === "FAILED" || !acquireGlobalLock(emailAccountId)) return;
    running.current = true;
    stopRequested.current = false;
    setMode("automatic");
    const startingProcessed = localProgress?.processedMessages ?? 0;
    let latestProgress = localProgress;
    try {
      for (let batch = 1; batch <= MAX_AUTO_BATCHES; batch += 1) {
        if (!mounted.current || stopRequested.current) break;
        setBatchNumber(batch);
        const next = await invokeBatch();
        if (!mounted.current) return;
        applyResult(next);
        if (next.progress) latestProgress = next.progress;
        if (!next.success || next.completed) return;
        if (stopRequested.current) {
          setResult({ success: true, completed: false, progress: latestProgress, message: "Stopped after the current batch. Continue when ready." });
          return;
        }
      }
      if (mounted.current && !stopRequested.current) {
        const processedThisRun = Math.max(0, (latestProgress?.processedMessages ?? startingProcessed) - startingProcessed);
        setResult({ success: true, completed: false, progress: latestProgress, message: `${processedThisRun} messages processed in this run. More messages may remain.` });
      }
    } catch {
      if (mounted.current) setResult({ success: false, completed: false, message: "The sync request could not be completed. Please try again." });
    } finally {
      releaseGlobalLock(emailAccountId);
      if (mounted.current) { running.current = false; stopRequested.current = false; setMode("idle"); setBatchNumber(0); }
    }
  }

  const displayed = localProgress;
  const completed = displayed?.status === "COMPLETED" || result.completed;
  const failed = displayed?.status === "FAILED";
  const busy = mode !== "idle" || testPending;
  const manualLabel = displayed ? failed ? "Resume sync" : "Continue sync" : "Start mailbox sync";
  const automaticLabel = displayed ? "Continue automatically" : "Start automatic sync";

  return (
    <div className="mt-4 rounded-lg border bg-slate-50 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 ring-1 ring-slate-200">{completed ? <CheckCircle2 className="size-4" /> : <Database className="size-4" />}</div>
          <div><p className="text-xs font-bold text-slate-800">Initial sync</p><p className="mt-0.5 text-[11px] text-slate-500">50 messages per request · automatic runs stop after {MAX_AUTO_BATCHES} batches</p></div>
        </div>
        <div className="grid grid-cols-4 gap-3 text-center text-[11px]">
          <Metric label="Processed" value={displayed?.processedMessages ?? 0} /><Metric label="Synced" value={displayed?.syncedMessages ?? 0} /><Metric label="Skipped" value={displayed?.skippedMessages ?? 0} /><Metric label="Failed" value={displayed?.failedMessages ?? 0} />
        </div>
        <div className="min-w-44 lg:text-right">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{mode === "automatic" ? `Syncing batch ${batchNumber} of ${MAX_AUTO_BATCHES}...` : mode === "manual" ? "Processing one batch..." : displayed?.status ?? "NOT STARTED"}</p>
          {completed ? <span className="text-xs font-semibold text-emerald-700">Mailbox indexed</span> : <div className="flex flex-wrap gap-2 lg:justify-end"><Button type="button" size="sm" disabled={busy || globallyBusy} onClick={runManualBatch}>{mode === "manual" && <LoaderCircle className="size-3.5 animate-spin" />}{manualLabel}</Button><Button type="button" size="sm" variant="outline" disabled={busy || globallyBusy || failed} onClick={runAutomatically}>{mode === "automatic" && <LoaderCircle className="size-3.5 animate-spin" />}{automaticLabel}</Button>{mode === "automatic" && <Button type="button" size="sm" variant="outline" onClick={() => { stopRequested.current = true; }}><OctagonX className="size-3.5" />Stop after current batch</Button>}</div>}
        </div>
      </div>
      <div className="mt-3 border-t pt-3"><SyncLatestMessagesButton emailAccountId={emailAccountId} disabled={mode !== "idle" || globallyBusy} onPendingChange={setTestPending} onBeforeSubmit={() => acquireGlobalLock(emailAccountId)} onComplete={() => releaseGlobalLock(emailAccountId)} />{blockedByOtherAccount && <p className="mt-2 text-xs text-slate-500">Another Gmail account is currently syncing.</p>}</div>
      {result.message && <p className={`mt-2 text-xs ${result.success ? "text-emerald-700" : "text-rose-600"}`} role={result.success ? "status" : "alert"}>{result.message}</p>}
      {displayed?.safeErrorCode && failed && <p className="mt-2 text-xs text-amber-700">The previous batch stopped safely. Use Resume sync to retry the saved checkpoint.</p>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) { return <div><p className="font-bold text-slate-800">{value}</p><p className="text-slate-400">{label}</p></div>; }
