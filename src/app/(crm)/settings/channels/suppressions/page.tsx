import { ChannelSuppressionsManager } from "@/modules/channels/components/channel-suppressions-manager";
import { listChannelSuppressions } from "@/modules/channels/server/list-channel-suppressions";
export default async function ChannelSuppressionsPage() { const result = await listChannelSuppressions(); return <ChannelSuppressionsManager suppressions={result.suppressions} error={result.error}/>; }
