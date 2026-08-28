import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const basePath = path.join(projectRoot, "src", specifier.slice(2));
      const resolvedPath = [basePath, `${basePath}.ts`, `${basePath}.tsx`].find((candidate) => existsSync(candidate));
      if (!resolvedPath) throw new Error("FIXTURE_MODULE_UNAVAILABLE");
      return { url: pathToFileURL(resolvedPath).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { claimReplySendRequestWithRpc } = await import(
  "../src/modules/integrations/gmail/server/claim-reply-send-request.ts"
);
const input = {
  sendRequestId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  emailAccountId: "33333333-3333-4333-8333-333333333333",
  sendLockId: "44444444-4444-4444-8444-444444444444",
};
const row = {
  request_id: input.sendRequestId,
  workspace_id: input.workspaceId,
  email_account_id: input.emailAccountId,
  reply_to_email_message_id: "55555555-5555-4555-8555-555555555555",
  send_lock_id: input.sendLockId,
  attempt_count: 1,
};
let count = 0;
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); count += 1; }

const calls = [];
const result = await claimReplySendRequestWithRpc(input, async (name, args) => {
  calls.push({ name, args });
  return { data: [row], error: null };
});
check("RPC called once", calls.length, 1);
check("exact RPC name", calls[0].name, "claim_reply_email_send_request");
check("exact RPC arguments", calls[0].args, {
  p_request_id: input.sendRequestId,
  p_workspace_id: input.workspaceId,
  p_email_account_id: input.emailAccountId,
  p_send_lock_id: input.sendLockId,
});
check("RPC arguments only four keys", Object.keys(calls[0].args).sort(),
  ["p_email_account_id", "p_request_id", "p_send_lock_id", "p_workspace_id"]);
check("exact array returned", result, [row]);
check("returned value remains array", Array.isArray(result), true);

await assert.rejects(() => claimReplySendRequestWithRpc(input, async () => ({ data: row, error: null })),
  /Reply claim unavailable/); count += 1;
await assert.rejects(() => claimReplySendRequestWithRpc(input, async () => ({ data: null, error: { code: "SAFE" } })),
  /Reply claim unavailable/); count += 1;
await assert.rejects(() => claimReplySendRequestWithRpc(input, async () => { throw new Error("rpc failure"); }),
  /rpc failure/); count += 1;
check("claim row exact keys", Object.keys(row).sort(), ["attempt_count", "email_account_id",
  "reply_to_email_message_id", "request_id", "send_lock_id", "workspace_id"]);

process.stdout.write(`gmail-reply-claim-wrapper fixtures: ${count} passed\n`);
