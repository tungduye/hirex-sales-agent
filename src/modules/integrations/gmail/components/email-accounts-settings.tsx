"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, ExternalLink, Mail, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InitialSyncControl } from "@/modules/integrations/gmail/components/initial-sync-control";
import { IncrementalSyncControl } from "@/modules/integrations/gmail/components/incremental-sync-control";
import type { EmailAccountMetadata } from "@/modules/integrations/gmail/types/email-account";
import type { InitialSyncProgress } from "@/modules/integrations/gmail/types/initial-sync";
import type { IncrementalSyncProgress } from "@/modules/integrations/gmail/types/incremental-sync";

interface Props {
  accounts: EmailAccountMetadata[];
  loadError: string | null;
  feedback:
    | "connected"
    | "error"
    | "send_enabled"
    | "send_already_enabled"
    | "send_denied"
    | "send_error"
    | "send_account_mismatch"
    | "send_scope_missing"
    | null;
  syncStates: InitialSyncProgress[];
  syncStatesError: string | null;
  incrementalSyncStates: IncrementalSyncProgress[];
  incrementalSyncStatesError: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("en", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function EmailAccountsSettings({ accounts, loadError, feedback, syncStates, syncStatesError, incrementalSyncStates, incrementalSyncStatesError }: Props) {
  const busyAccountRef = useRef<string | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);

  const tryAcquireAccountLock = useCallback((emailAccountId: string) => {
    if (busyAccountRef.current !== null) return false;
    busyAccountRef.current = emailAccountId;
    setBusyAccountId(emailAccountId);
    return true;
  }, []);

  const releaseAccountLock = useCallback((emailAccountId: string) => {
    if (busyAccountRef.current !== emailAccountId) return;
    busyAccountRef.current = null;
    setBusyAccountId(null);
  }, []);

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">Settings</h1><p className="mt-1 text-sm text-slate-500">Manage workspace integrations and connected accounts.</p></div>
      </div>

      {feedback === "connected" && <div className="mb-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status"><CheckCircle2 className="size-4" />Gmail connected successfully.</div>}
      {feedback === "error" && <div className="mb-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert"><AlertCircle className="size-4" />Gmail could not be connected. Please try again.</div>}
      {(feedback === "send_enabled" || feedback === "send_already_enabled") && <div className="mb-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700" role="status"><CheckCircle2 className="size-4" />{feedback === "send_enabled" ? "Gmail sending enabled." : "Gmail sending is already enabled."}</div>}
      {feedback === "send_denied" && <div className="mb-5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700" role="status"><AlertCircle className="size-4" />Sending permission was not granted. Readonly sync remains connected.</div>}
      {feedback === "send_account_mismatch" && <div className="mb-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert"><AlertCircle className="size-4" />Choose the same Google account that is connected to HireX.</div>}
      {feedback === "send_scope_missing" && <div className="mb-5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700" role="status"><AlertCircle className="size-4" />Gmail sending permission was not granted. Readonly sync remains connected.</div>}
      {feedback === "send_error" && <div className="mb-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700" role="alert"><AlertCircle className="size-4" />Gmail sending could not be enabled. Readonly sync remains connected.</div>}

      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-semibold">Email Accounts</h2><p className="mt-0.5 text-xs text-slate-500">Connected Gmail accounts for this workspace.</p></div>
          <Button asChild><Link href="/api/integrations/gmail/connect"><Plus className="size-4" />Connect Gmail <ExternalLink className="size-3.5" /></Link></Button>
        </div>

        {loadError ? (
          <div className="px-6 py-14 text-center"><AlertCircle className="mx-auto size-7 text-rose-500" /><p className="mt-3 text-sm font-semibold">Unable to load email accounts</p><p className="mt-1 text-xs text-slate-500">{loadError}</p></div>
        ) : accounts.length === 0 ? (
          <div className="px-6 py-14 text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Mail className="size-6" /></div><p className="mt-4 text-sm font-semibold">No email accounts connected</p><p className="mt-1 text-xs text-slate-500">Connect Gmail to prepare for readonly mailbox access in a later phase.</p></div>
        ) : (
          <div className="divide-y">
            {accounts.map((account) => {
              const initialProgress = syncStates.find((state) => state.emailAccountId === account.id) ?? null;
              const incrementalProgress = incrementalSyncStates.find((state) => state.emailAccountId === account.id) ?? null;
              return (
              <div key={account.id} className="px-5 py-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600"><Mail className="size-5" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{account.emailAddress}</p><p className="mt-0.5 truncate text-xs text-slate-500">{account.displayName ?? "Gmail account"} · {account.provider}</p></div>
                  <div className="sm:text-right"><span className={statusClassName(account.status)}>{account.status.replaceAll("_", " ")}</span><p className="mt-1.5 text-xs text-slate-400">{account.lastSyncAt ? `Last sync ${dateFormatter.format(new Date(account.lastSyncAt))}` : "Not fully synced yet"}</p></div>
                </div>
                {account.status === "CONNECTED" && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-600"><Send className="size-3.5" />{account.sendEnabled ? "Sending enabled" : "Sending is not enabled"}</div>
                    {!account.sendEnabled && <Button asChild size="sm" variant="outline"><Link href={`/api/integrations/gmail/enable-send?account=${encodeURIComponent(account.id)}`}>Enable sending <ExternalLink className="size-3.5" /></Link></Button>}
                  </div>
                )}
                {account.status === "CONNECTED" && !syncStatesError && <InitialSyncControl emailAccountId={account.id} progress={initialProgress} globallyBusy={busyAccountId !== null} blockedByOtherAccount={busyAccountId !== null && busyAccountId !== account.id} acquireGlobalLock={tryAcquireAccountLock} releaseGlobalLock={releaseAccountLock} />}
                {account.status === "CONNECTED" && syncStatesError && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{syncStatesError}</p>}
                {account.status === "CONNECTED" && initialProgress?.status === "COMPLETED" && !incrementalSyncStatesError && <IncrementalSyncControl emailAccountId={account.id} progress={incrementalProgress} globallyBusy={busyAccountId !== null} blockedByOtherAccount={busyAccountId !== null && busyAccountId !== account.id} acquireGlobalLock={tryAcquireAccountLock} releaseGlobalLock={releaseAccountLock} />}
                {account.status === "CONNECTED" && initialProgress?.status === "COMPLETED" && incrementalSyncStatesError && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{incrementalSyncStatesError}</p>}
              </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function statusClassName(status: EmailAccountMetadata["status"]) {
  const color = status === "CONNECTED"
    ? "bg-emerald-50 text-emerald-700"
    : status === "REAUTH_REQUIRED"
      ? "bg-amber-50 text-amber-700"
      : "bg-rose-50 text-rose-700";
  return `inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${color}`;
}
