import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const list = read("src/modules/inbox/server/get-omnichannel-inbox-data.ts");
const detailQuery = read("src/modules/inbox/server/get-omnichannel-conversation-detail.ts");
const view = read("src/modules/inbox/components/omnichannel-inbox-view.tsx");
const detail = read("src/modules/inbox/components/omnichannel-conversation-detail.tsx");
const route = read("src/app/(crm)/inbox/all/[conversationId]/page.tsx");
const types = read("src/modules/inbox/types/omnichannel-inbox.ts");
const refresh = read("src/modules/inbox/components/inbox-auto-refresh.tsx");
let assertions = 0;
function check(value, message) { assert.ok(value, message); assertions += 1; }

check(list.includes('from("omnichannel_conversations")'), "canonical conversation query");
check(list.includes('.eq("channel_type", selectedChannelType)'), "channel filter");
check(list.includes('.eq("channel_account_id", selectedAccountId)'), "account filter");
check(list.includes('.order("last_message_at", { ascending: false'), "latest activity ordering");
check(list.includes(".range("), "server pagination");
check(list.includes("PAGE_SIZE = 50"), "bounded page size");
check(detailQuery.includes('.eq("conversation_id", conversationId)'), "selected conversation messages only");
check(detailQuery.includes(".limit(MAX_MESSAGES + 1)"), "bounded detail timeline");
check(detailQuery.includes(".reverse()"), "timeline oldest to newest");
for (const tab of ["All", "Email", "Facebook", "Zalo"]) check(view.includes(`label: "${tab}"`), `${tab} tab`);
check(view.includes("All accounts"), "channel-independent account filter");
check(view.includes("Previous") && view.includes("Next"), "pagination controls");
check(view.includes("account.healthLabel"), "account health indicator");
check(view.includes("conversation.unreadCount"), "unread count");
check(refresh.includes("router.refresh()"), "lightweight refresh");
check(refresh.includes("document.visibilityState"), "hidden-tab refresh guard");
check(types.includes("OmnichannelConversationDetail"), "normalized detail model");
check(types.includes("OmnichannelInboxMessage"), "normalized message model");
check(route.includes("getThreadDetail") && route.includes("resolveLatestReplyTargetForThread"), "email thread and reply preserved");
check(detail.includes('conversation.channelType === "FACEBOOK" || conversation.channelType === "ZALO"'), "native Facebook and Zalo composer routing");
check(detail.includes("<ConversationComposer") && detail.includes("channelType={conversation.channelType}"), "channel-aware reviewed composer");
check(!detail.includes("sendRaw") && !detail.includes("ZaloService.sendMessage"), "UI contains no direct provider send path");
check(detailQuery.includes('eq("workspace_id", accountContext.workspaceId)'), "workspace scope");
for (const source of [list, detailQuery]) {
  check(source.includes('import "server-only"'), "data access remains server-only");
  check(source.includes('accountClient.from("channel_accounts")') && source.includes('.eq("workspace_id", accountContext.workspaceId)'), "account metadata is workspace scoped");
  check(source.includes('supabase.from("omnichannel_conversations")') && source.includes('supabase.from("omnichannel_messages")'), "conversation and message reads retain session RLS");
  check(!source.includes("access_token_encrypted") && !source.includes("webhook_secret_encrypted"), "credential columns never selected");
}

console.log(`OMNICHANNEL_INBOX_MVP_PASS assertions=${assertions}`);
