#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const SAFE_UNAVAILABLE_OUTPUT = Object.freeze({
  status: "UNAVAILABLE",
  reason: "EVALUATION_UNAVAILABLE",
  workspaceId: null,
  emailAccountId: null,
  emailMessageId: null,
  recipientEmail: null,
  subject: null,
  providerThreadId: null,
  parentRfcMessageId: null,
});

export async function runSafeControlledReplyPreflightBootstrap(bootstrap) {
  try { return await bootstrap(); } catch { return SAFE_UNAVAILABLE_OUTPUT; }
}

async function bootstrapControlledReplyPreflight() {
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
  const { runControlledReplyPreflightCli } = await import(
    "../src/modules/integrations/gmail/domain/controlled-reply-preflight.ts"
  );
  return runControlledReplyPreflightCli(process.argv.slice(2), process.env, {
    evaluate: async (input) => {
      const { evaluateReplyTarget } = await import(
        "../src/modules/integrations/gmail/server/evaluate-reply-target.ts"
      );
      return evaluateReplyTarget(input);
    },
  });
}

const isDirectInvocation = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectInvocation) {
  const output = await runSafeControlledReplyPreflightBootstrap(bootstrapControlledReplyPreflight);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.status !== "READY_FOR_CONTROLLED_REPLY_TEST") process.exitCode = 1;
}
