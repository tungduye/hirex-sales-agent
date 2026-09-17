#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    const file = [base, `${base}.ts`].find(existsSync);
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });

const { TRUSTED_ZALO_BRIDGE_ORIGIN, requireTrustedZaloBridgeOrigin } = await import("../src/modules/channels/adapters/zalo/trusted-bridge-origin.ts");
const { ZaloBridgeAdapter } = await import("../src/modules/channels/adapters/zalo/zalo-bridge-adapter.ts");
const { FetchChannelTransport } = await import("../src/modules/channels/core/channel-transport.ts");
let assertions = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); assertions += 1; };
equal(requireTrustedZaloBridgeOrigin(TRUSTED_ZALO_BRIDGE_ORIGIN), TRUSTED_ZALO_BRIDGE_ORIGIN);
equal(requireTrustedZaloBridgeOrigin(`${TRUSTED_ZALO_BRIDGE_ORIGIN}/`), TRUSTED_ZALO_BRIDGE_ORIGIN);
for (const candidate of [
  "http://zalo-bridge.hirexmkt.online",
  "https://evil.example",
  "https://zalo-bridge.hirexmkt.online.evil.example",
  "https://user:pass@zalo-bridge.hirexmkt.online",
  "https://zalo-bridge.hirexmkt.online:444",
  "https://zalo-bridge.hirexmkt.online:443",
  "https://zalo-bridge.hirexmkt.online/?redirect=evil",
  "https://zalo-bridge.hirexmkt.online/#fragment",
  "http://localhost:18788",
  "http://127.0.0.1:18788",
  "https://192.168.1.1",
  "https://zalo-bridge.hirexmkt.online@evil.example",
]) {
  assert.throws(() => requireTrustedZaloBridgeOrigin(candidate), /ZALO_BRIDGE_DESTINATION_UNTRUSTED/); assertions += 1;
}
let providerCalls = 0;
assert.throws(() => new ZaloBridgeAdapter("w", "a", { bridgeBaseUrl: "https://evil.example", bridgeAccountId: "id", signingSecret: "fixture" }, { request: async () => { providerCalls += 1; return { status: 200, body: {} }; } }), /ZALO_BRIDGE_DESTINATION_UNTRUSTED/); assertions += 1;
equal(providerCalls, 0);
const loaderSource = readFileSync(new URL("../src/modules/channels/server/load-channel-adapter.ts", import.meta.url), "utf8");
assert.ok(loaderSource.indexOf("trustedZaloOrigin=requireTrustedZaloBridgeOrigin") < loaderSource.indexOf("decryptChannelCredential(row.webhook_secret_encrypted)")); assertions += 1;

const previousFetch = globalThis.fetch;
let redirectMode = "";
globalThis.fetch = async (_url, options) => { redirectMode = options.redirect; throw new TypeError("redirect blocked"); };
try {
  await assert.rejects(() => new FetchChannelTransport().request({ method: "GET", url: `${TRUSTED_ZALO_BRIDGE_ORIGIN}/v1/health`, headers: {}, timeoutMs: 1000 }), TypeError); assertions += 1;
  equal(redirectMode, "error");
} finally { globalThis.fetch = previousFetch; }
console.log(`ZALO_BRIDGE_DESTINATION_PASS assertions=${assertions} providerCalls=${providerCalls}`);
