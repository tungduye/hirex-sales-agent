#!/usr/bin/env node
import assert from "node:assert/strict";
import { safeInboxPreview } from "../src/modules/inbox/core/safe-preview.ts";
import { readFileSync } from "node:fs";

let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
equal(safeInboxPreview("Normal text without a URL"), "Normal text without a URL");
equal(safeInboxPreview("Visit https://example.com/path soon"), "Visit https://example.com/path soon");
equal(safeInboxPreview("Visit https://example.com/path?token=SECRET&x=1 soon"), "Visit https://example.com/path soon");
equal(safeInboxPreview("https://example.com/path?x=1&access_token=SECRET#part"), "https://example.com/path");
equal(safeInboxPreview("Read https://example.com/path#jwt=SECRET"), "Read https://example.com/path");
equal(safeInboxPreview("www.example.com/path?signature=SECRET!"), "www.example.com/path");
equal(safeInboxPreview("URL-like www.example.com/path and ordinary words"), "URL-like www.example.com/path and ordinary words");
equal(safeInboxPreview(null), null);
equal(safeInboxPreview("  Keep   normal   email text  "), "Keep normal email text");
equal(safeInboxPreview("x".repeat(300))?.length, 241);
const listSource = readFileSync(new URL("../src/modules/inbox/server/get-omnichannel-inbox-data.ts", import.meta.url), "utf8");
assert.ok(listSource.includes('subject: safeInboxPreview(typeof row.subject === "string" ? row.subject : null)'), "subject preview redacted"); assertions += 1;
assert.ok(listSource.includes('latestText: safeInboxPreview(typeof message?.text_content === "string" ? message.text_content : null)'), "body preview redacted"); assertions += 1;
console.log(`INBOX_PREVIEW_SECURITY_PASS assertions=${assertions}`);
