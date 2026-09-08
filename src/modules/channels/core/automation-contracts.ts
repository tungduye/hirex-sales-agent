import type { ChannelType } from "./channel-contracts.ts";

export const AUTOMATION_TRIGGER_TYPES = [
  "MESSAGE_RECEIVED",
  "KEYWORD_MATCHED",
  "TAG_ADDED",
  "CONVERSATION_ASSIGNED",
  "SCHEDULED",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export const AUTOMATION_ACTION_TYPES = [
  "ADD_TAG",
  "REMOVE_TAG",
  "ASSIGN_CONVERSATION",
  "SET_CONVERSATION_STATUS",
  "PROPOSE_MESSAGE",
  "CREATE_TASK",
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export interface AutomationTrigger {
  type: AutomationTriggerType;
  channelTypes: ChannelType[];
  keywords: string[];
}

export interface AutomationAction {
  type: AutomationActionType;
  configuration: Readonly<Record<string, unknown>>;
}

export interface AutomationDefinition {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  version: number;
}

export interface AutomationEvaluation {
  automationId: string;
  matched: boolean;
  proposedActions: AutomationAction[];
}

export function normalizeKeywords(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))];
}

export function keywordTriggerMatches(keywords: readonly string[], message: string): boolean {
  const normalizedMessage = message.normalize("NFKC").toLocaleLowerCase();
  return normalizeKeywords(keywords).some((keyword) => normalizedMessage.includes(keyword.normalize("NFKC")));
}
