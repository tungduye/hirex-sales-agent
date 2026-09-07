import assert from "node:assert/strict";
import { parseQaRecipientAllowlist } from "./phase4c-qa-recipient-allowlist.mjs";

let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions += 1; };
const rejects = (raw) => { assert.throws(() => parseQaRecipientAllowlist(raw), /QA_ALLOWLIST_INVALID/); assertions += 1; };

equal(parseQaRecipientAllowlist("a@example.com;b@example.com"), ["a@example.com", "b@example.com"]);
equal(parseQaRecipientAllowlist("a@example.com,b@example.com"), ["a@example.com", "b@example.com"]);
equal(parseQaRecipientAllowlist("A@Example.com ; b@example.com "), ["a@example.com", "b@example.com"]);
equal(parseQaRecipientAllowlist("a@example.com;A@example.com,a@example.com"), ["a@example.com"]);
rejects("");
rejects("a@example.com;not-an-email");

console.log(`PHASE4C_QA_ALLOWLIST_FIXTURES_PASS assertions=${assertions}`);
