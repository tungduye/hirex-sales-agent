import { EmailAccountsSettings } from "@/modules/integrations/gmail/components/email-accounts-settings";
import { listEmailAccounts } from "@/modules/integrations/gmail/server/list-email-accounts";
import { listInitialSyncStates } from "@/modules/integrations/gmail/server/list-initial-sync-states";
import { listIncrementalSyncStates } from "@/modules/integrations/gmail/server/list-incremental-sync-states";

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
  const feedback = gmail === "connected" || gmail === "error" ? gmail : null;

  return (
    <EmailAccountsSettings
      accounts={result.accounts}
      loadError={result.error}
      feedback={feedback}
      syncStates={syncResult.states}
      syncStatesError={syncResult.error}
      incrementalSyncStates={incrementalSyncResult.states}
      incrementalSyncStatesError={incrementalSyncResult.error}
    />
  );
}
