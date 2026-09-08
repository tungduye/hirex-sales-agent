export interface ChannelAutomationSummary {
  id: string; name: string; enabled: boolean; version: number; triggerType: string;
  triggerConfig: Record<string, unknown>; actions: Array<Record<string, unknown>>;
}
export interface ChannelAutomationProposalSummary { id:string; actionType:string; configuration:Record<string,unknown>; createdAt:string; automationName:string }
