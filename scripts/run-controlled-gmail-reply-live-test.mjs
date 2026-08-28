#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const SAFE_UNAVAILABLE_OUTPUT = Object.freeze({
  status: "UNAVAILABLE", reason: "LIVE_TEST_UNAVAILABLE", sendRequestId: null,
  workspaceId: null, emailAccountId: null, emailMessageId: null, requestCreationStatus: null,
  executorStatus: null, executorReason: null, finalRequestStatus: null,
  providerMessageId: null, providerThreadId: null,
});

export async function runSafeControlledReplyLiveTestBootstrap(bootstrap) {
  try { return await bootstrap(); } catch { return SAFE_UNAVAILABLE_OUTPUT; }
}

async function bootstrapControlledReplyLiveTest() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
      if (specifier.startsWith("@/")) {
        const basePath = path.join(projectRoot, "src", specifier.slice(2));
        const resolvedPath = [basePath, `${basePath}.ts`, `${basePath}.tsx`].find((candidate) => existsSync(candidate));
        if (!resolvedPath) throw new Error("OPERATOR_MODULE_UNAVAILABLE");
        return { url: pathToFileURL(resolvedPath).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(projectRoot);
  const [{ runControlledReplyLiveTestCli }, { mapEvaluation }] = await Promise.all([
    import("../src/modules/integrations/gmail/domain/controlled-reply-live-test.ts"),
    import("../src/modules/integrations/gmail/domain/controlled-reply-preflight.ts"),
  ]);
  return runControlledReplyLiveTestCli(process.argv.slice(2), process.env, {
    preflight: async (input) => {
      const { evaluateReplyTarget } = await import("../src/modules/integrations/gmail/server/evaluate-reply-target.ts");
      return mapEvaluation(input, await evaluateReplyTarget(input));
    },
    createRequest: async (input) => {
      const { createReplySendRequest } = await import("../src/modules/integrations/gmail/server/create-reply-send-request.ts");
      return createReplySendRequest(input);
    },
    inspectRequest: async (input) => {
      const { inspectReplySendRequest } = await import("../src/modules/integrations/gmail/server/inspect-reply-send-request.ts");
      return inspectReplySendRequest(input);
    },
    executeRequest: async (input) => {
      const { sendOneReplyMessage } = await import("../src/modules/integrations/gmail/server/send-one-reply-message.ts");
      return sendOneReplyMessage(input);
    },
  });
}

const isDirectInvocation = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectInvocation) {
  const output = await runSafeControlledReplyLiveTestBootstrap(bootstrapControlledReplyLiveTest);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.status !== "VERIFIED_SENT" && output.status !== "VERIFIED_FAILED") process.exitCode = 1;
}
