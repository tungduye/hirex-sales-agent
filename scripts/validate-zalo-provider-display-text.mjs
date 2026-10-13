import assert from "node:assert/strict";
import { zaloProviderDisplayText } from "../src/modules/inbox/core/zalo-provider-display-text.ts";

const cases = [
  ["plain", "plain"],
  [JSON.stringify({ title: "Hello", description: "World", params: "opaque" }), "Hello\nWorld"],
  [JSON.stringify({ href: "https://example.com/a", tracking: { secret: "opaque" } }), "https://example.com/a"],
  [JSON.stringify({ params: "opaque" }), "Zalo provider event"],
  [JSON.stringify([{ title: "One" }, { title: "Two" }]), "One\nTwo"],
];
for (const [input, expected] of cases) assert.equal(zaloProviderDisplayText(input), expected);
console.log(`ZALO_PROVIDER_DISPLAY_PASS assertions=${cases.length}`);
