import { EmailAccountsSettings } from "@/modules/integrations/gmail/components/email-accounts-settings";
import { listEmailAccounts } from "@/modules/integrations/gmail/server/list-email-accounts";
import { listInitialSyncStates } from "@/modules/integrations/gmail/server/list-initial-sync-states";
import { listIncrementalSyncStates } from "@/modules/integrations/gmail/server/list-incremental-sync-states";
import Link from "next/link";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const [{ gmail }, result, syncResult, incrementalSyncResult] = await Promise.all([
    searchParams,
    listEmailAccounts(),
    listInitialSyncStates(),
    listIncrementalSyncStates(),
  ]);
  const allowedFeedback = [
    "connected",
    "error",
    "send_enabled",
    "send_already_enabled",
    "send_denied",
    "send_error",
    "send_account_mismatch",
    "send_scope_missing",
  ] as const;
  const feedback = allowedFeedback.find((value) => value === gmail) ?? null;

  return (
    <><div className="mb-4 flex justify-end"><Link href="/settings/email-automation" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Email Automation health</Link></div><EmailAccountsSettings
      accounts={result.accounts}
      loadError={result.error}
      feedback={feedback}
      syncStates={syncResult.states}
      syncStatesError={syncResult.error}
      incrementalSyncStates={incrementalSyncResult.states}
      incrementalSyncStatesError={incrementalSyncResult.error}
    /></>
  );
}
