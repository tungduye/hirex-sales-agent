import { EmailAccountsSettings } from "@/modules/integrations/gmail/components/email-accounts-settings";
import { listEmailAccounts } from "@/modules/integrations/gmail/server/list-email-accounts";
import { listInitialSyncStates } from "@/modules/integrations/gmail/server/list-initial-sync-states";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const [{ gmail }, result, syncResult] = await Promise.all([
    searchParams,
    listEmailAccounts(),
    listInitialSyncStates(),
  ]);
  const feedback = gmail === "connected" || gmail === "error" ? gmail : null;

  return (
    <EmailAccountsSettings
      accounts={result.accounts}
      loadError={result.error}
      feedback={feedback}
      syncStates={syncResult.states}
      syncStatesError={syncResult.error}
    />
  );
}
