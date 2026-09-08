import { AutomationManager } from "@/modules/channels/components/automation-manager";
import { listChannelAutomations } from "@/modules/channels/server/list-channel-automations";

export default async function ChannelAutomationsPage() {
  const result = await listChannelAutomations();
  return <AutomationManager automations={result.automations} proposals={result.proposals} error={result.error}/>;
}
