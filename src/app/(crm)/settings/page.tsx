import { EmailAccountsSettings } from "@/modules/integrations/gmail/components/email-accounts-settings";
import { listEmailAccounts } from "@/modules/integrations/gmail/server/list-email-accounts";
import { listInitialSyncStates } from "@/modules/integrations/gmail/server/list-initial-sync-states";
import { listIncrementalSyncStates } from "@/modules/integrations/gmail/server/list-incremental-sync-states";
import Link from "next/link";
import { hasPermission, isWorkspaceAdmin } from "@/modules/access/server/access-control";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const [{ gmail }, result, syncResult, incrementalSyncResult, canManageAutomation, canViewRoles, canViewChannels] = await Promise.all([
    searchParams,
    listEmailAccounts(),
    listInitialSyncStates(),
    listIncrementalSyncStates(),
    isWorkspaceAdmin(),
    hasPermission("roles.view"),
    hasPermission("channels.view"),
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
    <><div className="mb-4">{canManageAutomation && <Link href="/settings/human" className="inline-block rounded-lg border bg-white px-4 py-2 text-sm text-blue-700">Kết nối Human · Tài liệu</Link>}</div>
    <><div className="mb-4 flex flex-wrap justify-end gap-2">{canViewRoles && <Link href="/settings/roles" className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Vai trò và phân quyền</Link>}{canViewChannels && <Link href="/settings/channels" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Tài khoản kênh</Link>}{canManageAutomation && <Link href="/settings/automation" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Tự động hoá</Link>}{canViewChannels && <Link href="/settings/email-automation" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Trạng thái tự động hóa email</Link>}</div><EmailAccountsSettings
      accounts={result.accounts}
      loadError={result.error}
      feedback={feedback}
      syncStates={syncResult.states}
      syncStatesError={syncResult.error}
      incrementalSyncStates={incrementalSyncResult.states}
      incrementalSyncStatesError={incrementalSyncResult.error}
    /></>
    </>
  );
}
