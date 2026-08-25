import { EmailAccountsSettings } from "@/modules/integrations/gmail/components/email-accounts-settings";
import { listEmailAccounts } from "@/modules/integrations/gmail/server/list-email-accounts";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const [{ gmail }, result] = await Promise.all([
    searchParams,
    listEmailAccounts(),
  ]);
  const feedback = gmail === "connected" || gmail === "error" ? gmail : null;

  return (
    <EmailAccountsSettings
      accounts={result.accounts}
      loadError={result.error}
      feedback={feedback}
    />
  );
}
