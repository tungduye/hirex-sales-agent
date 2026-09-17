#!/usr/bin/env node
import assert from "node:assert/strict";
import { zaloContactIdentity, zaloConnectCapabilities } from "../src/modules/channels/core/zalo-account-policy.ts";
import { evaluateZaloProviderHealth } from "../src/modules/channels/core/provider-health.ts";

let assertions = 0;
const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const a = zaloContactIdentity("workspace", "account-a", "sender");
const b = zaloContactIdentity("workspace", "account-b", "sender");
eq(zaloContactIdentity("workspace", "account-a", "sender"), a);
eq(a.contactId === b.contactId, false);
eq(a.channelId === b.channelId, false);
eq(a.contactId === zaloContactIdentity("other-workspace", "account-a", "sender").contactId, false);
eq(zaloConnectCapabilities({ isExisting: false, existingCapabilities: null, providerAccountId: "account-b", qaProviderAccountId: "account-a" }), ["READ_RECEIPTS"]);
eq(zaloConnectCapabilities({ isExisting: true, existingCapabilities: ["SEND_TEXT"], providerAccountId: "account-b", qaProviderAccountId: "account-a" }), ["READ_RECEIPTS"]);
eq(zaloConnectCapabilities({ isExisting: true, existingCapabilities: ["SEND_TEXT"], providerAccountId: "account-a", qaProviderAccountId: "account-a" }), ["SEND_TEXT", "REPLY", "READ_RECEIPTS"]);
eq(zaloConnectCapabilities({ isExisting: true, existingCapabilities: ["SEND_TEXT"], providerAccountId: "account-a", qaProviderAccountId: undefined }), ["READ_RECEIPTS"]);
const now = new Date("2026-09-17T12:00:00.000Z");
eq(evaluateZaloProviderHealth({ operatorEnabled: true, status: "HEALTHY", checkedAt: now.toISOString() }, now), { allowed: true });
eq(evaluateZaloProviderHealth({ operatorEnabled: true, status: "DISCONNECTED", checkedAt: now.toISOString() }, now), { allowed: false, reason: "PROVIDER_DISCONNECTED" });
eq(evaluateZaloProviderHealth({ operatorEnabled: false, status: "HEALTHY", checkedAt: now.toISOString() }, now), { allowed: false, reason: "CHANNEL_DISABLED" });
console.log(`ZALO_MULTI_ACCOUNT_FOUNDATION_PASS assertions=${assertions} remoteCalls=0 providerCalls=0`);
