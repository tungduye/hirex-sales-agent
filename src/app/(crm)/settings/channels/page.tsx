import { ChannelAccountsView } from "@/modules/channels/components/channel-accounts-view";
import { listChannelAccounts } from "@/modules/channels/server/list-channel-accounts";
import { QuickRepliesManager } from "@/modules/channels/components/quick-replies-manager";
import { listQuickReplies } from "@/modules/channels/server/list-quick-replies";
import Link from "next/link";
import { ChannelConnectForms } from "@/modules/channels/components/channel-connect-forms";
import { ZaloSendLockAlert } from "@/modules/channels/components/zalo-send-lock-alert";
import { listZaloSendLocks } from "@/modules/channels/server/list-zalo-send-locks";
import { CandidateFactNicks } from "@/modules/rec-flow/components/candidate-fact-nicks";
import { listCandidateFactNicks } from "@/modules/rec-flow/server/candidate-fact-nicks";

export default async function ChannelAccountsPage() {
  const [accounts, quickReplies, sendLocks, factNicks] = await Promise.all([listChannelAccounts(), listQuickReplies(), listZaloSendLocks(), listCandidateFactNicks()]);
  return <div className="space-y-8"><div className="flex justify-end gap-2"><Link href="/settings/channels/suppressions" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Suppressions</Link><Link href="/settings/channels/automations" className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Workflow automation</Link></div><ZaloSendLockAlert locks={sendLocks.locks} now={sendLocks.checkedAt}/>{factNicks ? <CandidateFactNicks nicks={factNicks}/> : null}<ChannelAccountsView result={accounts} /><ChannelConnectForms/><QuickRepliesManager templates={quickReplies.templates} error={quickReplies.error}/></div>;
}
