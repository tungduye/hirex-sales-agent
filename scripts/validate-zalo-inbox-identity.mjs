import assert from "node:assert/strict";
import { zaloContactDisplayName, mayUpgradeZaloContactName, mayUpgradeZaloAccountName } from "../src/modules/channels/core/zalo-display-identity.ts";

let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
equal(zaloContactDisplayName("123", "Nguyen A"), "Nguyen A");
equal(zaloContactDisplayName("123", null), "Zalo 123");
equal(mayUpgradeZaloContactName("Zalo contact", "123"), true);
equal(mayUpgradeZaloContactName("Zalo 123", "123"), true);
equal(mayUpgradeZaloContactName("Operator name", "123"), false);
equal(mayUpgradeZaloAccountName("HireX QA zalo", "456"), true);
equal(mayUpgradeZaloAccountName("Zalo 456", "456"), true);
equal(mayUpgradeZaloAccountName("Operator account", "456"), false);
console.log(`ZALO_INBOX_IDENTITY_PASS assertions=${assertions}`);
