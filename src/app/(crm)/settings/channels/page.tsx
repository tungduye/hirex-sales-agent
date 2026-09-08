import { ChannelAccountsView } from "@/modules/channels/components/channel-accounts-view";
import { listChannelAccounts } from "@/modules/channels/server/list-channel-accounts";
import { QuickRepliesManager } from "@/modules/channels/components/quick-replies-manager";
import { listQuickReplies } from "@/modules/channels/server/list-quick-replies";
import Link from "next/link";
import { ChannelConnectForms } from "@/modules/channels/components/channel-connect-forms";

export default async function ChannelAccountsPage() {
  const [accounts, quickReplies] = await Promise.all([listChannelAccounts(), listQuickReplies()]);
  return <div className="space-y-8"><div className="flex justify-end gap-2"><Link href="/settings/channels/suppressions" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Suppressions</Link><Link href="/settings/channels/automations" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Workflow automation</Link></div><ChannelAccountsView result={accounts} /><ChannelConnectForms/><QuickRepliesManager templates={quickReplies.templates} error={quickReplies.error}/></div>;
}
