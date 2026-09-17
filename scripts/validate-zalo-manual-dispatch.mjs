import { readFileSync } from "node:fs";

let assertions = 0;
const check = (condition, label) => { assertions += 1; if (!condition) throw new Error(label); };
const dispatcher = readFileSync("src/modules/channels/server/dispatch-manual-zalo-action.ts", "utf8");
const route = readFileSync("src/app/api/internal/channels/dispatch-approved-zalo-qa/route.ts", "utf8");
const actions = readFileSync("src/modules/channels/server/channel-actions.ts", "utf8");

check(dispatcher.includes('const QA_TEXT = "HireX outbound QA 01"'), "exact QA text");
check(dispatcher.includes('HIREX_ZALO_REAL_OUTBOUND_QA_ENABLED !== "1"'), "QA environment gate");
check(dispatcher.includes("createPrivilegedClient()"), "server-only privileged evidence lookup");
check(dispatcher.includes('action.status !== "APPROVED"'), "approved-only eligibility");
check(dispatcher.includes("action.attempt_count !== 0"), "first-attempt eligibility");
check(dispatcher.includes('channelAccount.capabilities.includes("SEND_TEXT")'), "SEND_TEXT capability guard");
check(dispatcher.includes("conversation.provider_conversation_id !== action.recipient_external_id"), "server-derived conversation recipient");
check(dispatcher.includes("executeChannelOutboundAction(actionId, registry)"), "normal claim and finalization executor");
check(dispatcher.includes('reason_codes: ["QA_OPERATOR_REAUTHORIZED"]'), "expired QA policy creates explicit fresh evidence");
check(dispatcher.includes('.eq("status", "APPROVED").eq("attempt_count", 0).eq("policy_decision_id", policy.id)'), "policy rebound is compare-and-set scoped");
check(dispatcher.includes('Date.now() + 10 * 60_000'), "refreshed policy remains bounded");
check(route.includes("timingSafeEqual"), "constant-time bearer comparison");
check(route.includes("AUTOMATION_CRON_SECRET"), "internal route bearer guard");
check(route.includes("bodySchema.safeParse"), "strict request validation");
check(route.includes("dispatchApprovedZaloQaAction(parsed.data.actionId)"), "existing action dispatch only");
check(!route.includes("recipient") && !route.includes("text_content") && !route.includes("idempotency"), "browser cannot supply recipient, text, or idempotency");
check(actions.includes("dispatchManualZaloAction(parsed.data)"), "manual approval path uses same dispatcher");

console.log(`ZALO_MANUAL_DISPATCH_ASSERTIONS=${assertions}`);
console.log("ZALO_MANUAL_DISPATCH_VALIDATOR=PASS");
