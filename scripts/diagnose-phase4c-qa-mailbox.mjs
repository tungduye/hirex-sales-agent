#!/usr/bin/env node
import { loadQaRecipientAllowlist } from "./phase4c-qa-recipient-allowlist.mjs";

const mailbox = process.argv[2]?.trim().toLowerCase() ?? "";
const allowlist = loadQaRecipientAllowlist();
const mailboxValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox);

console.log(`QA_ALLOWLIST_ENTRY_COUNT=${allowlist.length}`);
console.log(`CURRENT_MAILBOX_NORMALIZED=${mailboxValid ? mailbox : "<invalid>"}`);
console.log(`CURRENT_MAILBOX_ALLOWLIST_MATCH=${mailboxValid && allowlist.includes(mailbox)}`);
console.log(`QA_ALLOWLIST_NORMALIZED=${allowlist.join(";")}`);
