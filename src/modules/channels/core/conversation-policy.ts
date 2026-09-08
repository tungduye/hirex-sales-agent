export const CONVERSATION_STATUSES = ["OPEN", "PENDING", "RESOLVED", "SPAM"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const TAKEOVER_MODES = ["BOT_ALLOWED", "HUMAN_TAKEOVER"] as const;
export type TakeoverMode = (typeof TAKEOVER_MODES)[number];

export interface ConversationPolicyState {
  status: ConversationStatus;
  takeoverMode: TakeoverMode;
  assignedTo: string | null;
  globallySuppressed: boolean;
  channelOptedOut: boolean;
}

export type ConversationPolicyEvent =
  | { type: "ASSIGN"; profileId: string }
  | { type: "UNASSIGN" }
  | { type: "TAKE_OVER"; profileId: string }
  | { type: "RELEASE_TO_ASSIST" }
  | { type: "MARK_PENDING" }
  | { type: "RESOLVE" }
  | { type: "REOPEN" }
  | { type: "MARK_SPAM" };

export function reduceConversationPolicy(
  state: ConversationPolicyState,
  event: ConversationPolicyEvent,
): ConversationPolicyState {
  switch (event.type) {
    case "ASSIGN":
      return { ...state, assignedTo: event.profileId };
    case "UNASSIGN":
      return { ...state, assignedTo: null };
    case "TAKE_OVER":
      return {
        ...state,
        status: state.status === "RESOLVED" ? "OPEN" : state.status,
        takeoverMode: "HUMAN_TAKEOVER",
        assignedTo: event.profileId,
      };
    case "RELEASE_TO_ASSIST":
      return { ...state, takeoverMode: "BOT_ALLOWED" };
    case "MARK_PENDING":
      return state.status === "SPAM" ? state : { ...state, status: "PENDING" };
    case "RESOLVE":
      return state.status === "SPAM" ? state : { ...state, status: "RESOLVED" };
    case "REOPEN":
      return state.status === "SPAM" ? state : { ...state, status: "OPEN" };
    case "MARK_SPAM":
      return { ...state, status: "SPAM", takeoverMode: "HUMAN_TAKEOVER" };
  }
}

export function canAutomateConversation(state: ConversationPolicyState): boolean {
  return (
    state.status !== "RESOLVED" &&
    state.status !== "SPAM" &&
    state.takeoverMode === "BOT_ALLOWED" &&
    !state.globallySuppressed &&
    !state.channelOptedOut
  );
}
