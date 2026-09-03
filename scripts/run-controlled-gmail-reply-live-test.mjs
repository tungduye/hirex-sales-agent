#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const SAFE_UNAVAILABLE_OUTPUT = Object.freeze({
  status: "UNAVAILABLE", reason: "LIVE_TEST_BOOTSTRAP_UNAVAILABLE", sendRequestId: null,
  workspaceId: null, emailAccountId: null, emailMessageId: null, requestCreationStatus: null,
  executorStatus: null, executorReason: null, failureStage: "BOOTSTRAP", finalRequestStatus: null,
  providerMessageId: null, providerThreadId: null,
});
let moduleHooksConfigured = false;

export async function runSafeControlledReplyLiveTestBootstrap(bootstrap) {
  try { return await bootstrap(); } catch { return SAFE_UNAVAILABLE_OUTPUT; }
}

function configureModuleResolution() {
  if (moduleHooksConfigured) return;
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
  moduleHooksConfigured = true;
}

export async function loadControlledReplyLiveTestProductionDependencies() {
  configureModuleResolution();
  const [domain, preflightDomain, evaluatorModule, creationModule, inspectionModule, executorModule,
    claimModule, plannerModule, credentialModule, , finalizerModule] = await Promise.all([
    import("../src/modules/integrations/gmail/domain/controlled-reply-live-test.ts"),
    import("../src/modules/integrations/gmail/domain/controlled-reply-preflight.ts"),
    import("../src/modules/integrations/gmail/server/evaluate-reply-target.ts"),
    import("../src/modules/integrations/gmail/server/create-reply-send-request.ts"),
    import("../src/modules/integrations/gmail/server/inspect-reply-send-request.ts"),
    import("../src/modules/integrations/gmail/server/send-one-reply-message.ts"),
    import("../src/modules/integrations/gmail/server/claim-reply-send-request.ts"),
    import("../src/modules/integrations/gmail/server/prepare-claimed-reply-execution.ts"),
    import("../src/modules/integrations/gmail/server/send-credentials.ts"),
    import("../src/modules/integrations/gmail/server/gmail-send-api.ts"),
    import("../src/modules/integrations/gmail/server/finalize-reply-send-request.ts"),
  ]);
  const required = [domain.runControlledReplyLiveTestCli, preflightDomain.mapEvaluation,
    evaluatorModule.evaluateReplyTarget, creationModule.createReplySendRequest,
    inspectionModule.inspectReplySendRequest, executorModule.sendOneReplyMessage,
    claimModule.claimReplySendRequest, plannerModule.prepareClaimedReplyExecution,
    credentialModule.loadGmailSendCredentials,
    finalizerModule.finalizeReplySendRequestSent, finalizerModule.finalizeReplySendRequestFailed];
  if (!required.every((value) => typeof value === "function")) throw new Error("OPERATOR_MODULE_UNAVAILABLE");
  return {
    runControlledReplyLiveTestCli: domain.runControlledReplyLiveTestCli,
    mapEvaluation: preflightDomain.mapEvaluation,
    evaluateReplyTarget: evaluatorModule.evaluateReplyTarget,
    createReplySendRequest: creationModule.createReplySendRequest,
    inspectReplySendRequest: inspectionModule.inspectReplySendRequest,
    sendOneReplyMessage: executorModule.sendOneReplyMessage,
  };
}

async function bootstrapControlledReplyLiveTest() {
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(projectRoot);
  const { runControlledReplyLiveTestCli, mapEvaluation, evaluateReplyTarget,
    createReplySendRequest, inspectReplySendRequest, sendOneReplyMessage }
    = await loadControlledReplyLiveTestProductionDependencies();
  return runControlledReplyLiveTestCli(process.argv.slice(2), process.env, {
    preflight: async (input) => mapEvaluation(input, await evaluateReplyTarget(input)),
    createRequest: createReplySendRequest,
    inspectRequest: inspectReplySendRequest,
    executeRequest: sendOneReplyMessage,
  });
}

const isDirectInvocation = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectInvocation) {
  const output = await runSafeControlledReplyLiveTestBootstrap(bootstrapControlledReplyLiveTest);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.status !== "VERIFIED_SENT" && output.status !== "VERIFIED_FAILED") process.exitCode = 1;
}
