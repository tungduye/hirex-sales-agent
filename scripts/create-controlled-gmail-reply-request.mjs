#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const SAFE_UNAVAILABLE_OUTPUT = Object.freeze({
  status: "UNAVAILABLE", reason: "REPLY_REQUEST_UNAVAILABLE", sendRequestId: null,
  workspaceId: null, emailAccountId: null, emailMessageId: null,
  requestStatus: null, sendType: null,
});

export async function runSafeControlledReplyRequestCreationBootstrap(bootstrap) {
  try { return await bootstrap(); } catch { return SAFE_UNAVAILABLE_OUTPUT; }
}

async function bootstrapControlledReplyRequestCreation() {
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
  const { runControlledReplyRequestCreationCli } = await import(
    "../src/modules/integrations/gmail/domain/controlled-reply-request-creation.ts"
  );
  return runControlledReplyRequestCreationCli(process.argv.slice(2), process.env, {
    create: async (input) => {
      const { createReplySendRequest } = await import(
        "../src/modules/integrations/gmail/server/create-reply-send-request.ts"
      );
      return createReplySendRequest(input);
    },
  });
}

const isDirectInvocation = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectInvocation) {
  const output = await runSafeControlledReplyRequestCreationBootstrap(bootstrapControlledReplyRequestCreation);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.status !== "CREATED" && output.status !== "EXISTING") process.exitCode = 1;
}
