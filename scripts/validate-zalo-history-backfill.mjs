import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapZaloHistoryRow, summarizeZaloHistory } from "./lib/zalo-history-backfill.mjs";
import { stableUuid } from "./lib/zalo-history-remote-writer.mjs";

let assertions = 0;
function check(value, label) { assert.ok(value, label); assertions += 1; }
const row = { account_id: "111892620045444006", provider_message_id: "8285396786726", thread_id: "7072192248263976974",
  thread_type: 0, sender_id: "7072192248263976974", content: "hello", msg_type: "webchat", timestamp_text: "1789910820000",
  is_sent: 0, attachments: "[]", local_paths: "{}", conversation_name: "Tùng Duy", avatar_url: "https://avatar.example/zalo.jpg" };
const inbound = mapZaloHistoryRow(row, "C:\\qa-profile");
check(inbound.ok, "valid user inbound");
check(inbound.value.direction === "INBOUND" && inbound.value.conversationKind === "USER", "user inbound classification");
check(inbound.value.text === "hello" && inbound.value.attachmentCount === 0, "text mapping");
check(inbound.value.conversationName === "Tùng Duy" && inbound.value.avatarUrl === "https://avatar.example/zalo.jpg", "conversation identity mapping");
check(mapZaloHistoryRow({ ...row, avatar_url: "http://unsafe.example/avatar.jpg" }, "C:\\qa-profile").value.avatarUrl === null, "non-HTTPS avatar rejected");
const group = mapZaloHistoryRow({ ...row, provider_message_id: "8285396786727", thread_type: 1, is_sent: 1, msg_type: "system", content: "" }, "C:\\qa-profile");
check(group.ok && group.value.direction === "OUTBOUND" && group.value.conversationKind === "GROUP", "group outbound classification");
check(group.value.text === "[Zalo system event]", "system event retained");
const providerSystem = mapZaloHistoryRow({ ...row, provider_message_id: "8285396786730", sender_id: "system", msg_type: "system", content: "" }, "C:\\qa-profile");
check(providerSystem.ok && providerSystem.value.senderId === "system", "safe provider system sender retained");
const syntheticSystem = mapZaloHistoryRow({ ...row, provider_message_id: "system-8285396786731", sender_id: "system", msg_type: "system", content: "" }, "C:\\qa-profile");
check(syntheticSystem.ok, "safe historical synthetic message id retained");
const photo = mapZaloHistoryRow({ ...row, provider_message_id: "8285396786728", msg_type: "chat.photo", content: "" }, "C:\\qa-profile");
check(photo.ok && photo.value.attachmentCount === 1 && photo.value.text === "[Zalo image]", "missing historical media remains represented");
check(!mapZaloHistoryRow({ ...row, account_id: "bad" }, "C:\\qa-profile").ok, "invalid account rejected");
check(!mapZaloHistoryRow({ ...row, timestamp_text: "not-time" }, "C:\\qa-profile").ok, "invalid timestamp rejected");
check(inbound.value.idempotencyKey === mapZaloHistoryRow(row, "C:\\qa-profile").value.idempotencyKey, "stable idempotency");
const summary = summarizeZaloHistory([row, { ...row, provider_message_id: "8285396786729", thread_type: 1, is_sent: 1 }], "C:\\qa-profile");
check(summary.total === 2 && summary.valid === 2 && summary.invalid === 0, "summary totals");
check(summary.inbound === 1 && summary.outbound === 1 && summary.user === 1 && summary.group === 1, "summary dimensions");
check(stableUuid("same") === stableUuid("same") && stableUuid("same") !== stableUuid("other"), "stable UUID identity");
check(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(stableUuid("shape")), "stable UUID shape");
const executorSource = readFileSync(new URL("./backfill-zalo-history.mjs", import.meta.url), "utf8");
const writerSource = readFileSync(new URL("./lib/zalo-history-remote-writer.mjs", import.meta.url), "utf8");
check(executorSource.includes('HIREX_ALLOW_REMOTE_ZALO_HISTORY_BACKFILL !== "1"'), "remote mutation guard retained");
check(executorSource.includes('HIREX_ALLOW_REMOTE_ZALO_IDENTITY_ENRICHMENT !== "1"'), "identity enrichment mutation guard retained");
check(executorSource.includes("ZALO_HISTORY_IDENTITY_ENRICHMENT_PASS"), "identity-only enrichment mode retained");
check(!/sendMessage|sendText|ZaloService|\/send\b/u.test(`${executorSource}\n${writerSource}`), "no provider send path");
check(writerSource.includes('source: "ZALO_INBOUND"') && writerSource.includes('source: "INBOUND_PROVIDER"'), "reviewed schema sources used");
check(writerSource.includes("conversationDisplayName") && writerSource.includes("avatarUrl"), "conversation name and avatar persisted");
console.log(`ZALO_HISTORY_BACKFILL_VALIDATOR_PASS assertions=${assertions}`);
