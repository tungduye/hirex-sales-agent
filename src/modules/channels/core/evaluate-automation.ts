import { canAutomateConversation, type ConversationPolicyState } from "./conversation-policy.ts";
import { keywordTriggerMatches, type AutomationAction, type AutomationDefinition, type AutomationEvaluation } from "./automation-contracts.ts";
import type { ChannelType } from "./channel-contracts.ts";

export interface AutomationEvent {
  id: string;
  workspaceId: string;
  channelType: ChannelType;
  conversationId: string;
  type: "MESSAGE_RECEIVED" | "TAG_ADDED" | "CONVERSATION_ASSIGNED" | "SCHEDULED";
  text: string | null;
  tagId: string | null;
}

const actionTypes = new Set<AutomationAction["type"]>([
  "ADD_TAG", "REMOVE_TAG", "ASSIGN_CONVERSATION", "SET_CONVERSATION_STATUS", "PROPOSE_MESSAGE", "CREATE_TASK",
]);

function actionsAreSafe(actions: readonly AutomationAction[]): boolean {
  return actions.length > 0 && actions.length <= 20 && actions.every((action) =>
    action && actionTypes.has(action.type) && action.configuration && typeof action.configuration === "object" && !Array.isArray(action.configuration),
  );
}

export function evaluateAutomation(input: {
  definition: AutomationDefinition;
  event: AutomationEvent;
  conversationPolicy: ConversationPolicyState;
}): AutomationEvaluation {
  const { definition, event, conversationPolicy } = input;
  if (!definition.enabled || definition.workspaceId !== event.workspaceId || !definition.trigger.channelTypes.includes(event.channelType) || !actionsAreSafe(definition.actions) || !canAutomateConversation(conversationPolicy)) {
    return { automationId: definition.id, matched: false, proposedActions: [] };
  }
  let matched = false;
  if (definition.trigger.type === "KEYWORD_MATCHED") matched = event.type === "MESSAGE_RECEIVED" && typeof event.text === "string" && keywordTriggerMatches(definition.trigger.keywords, event.text);
  else matched = definition.trigger.type === event.type;
  return { automationId: definition.id, matched, proposedActions: matched ? [...definition.actions] : [] };
}
