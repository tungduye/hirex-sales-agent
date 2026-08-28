#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");

const SAFE_UNAVAILABLE_OUTPUT = Object.freeze({
  status: "UNAVAILABLE",
  code: "INSPECTOR_UNAVAILABLE",
});

export async function runSafeOperatorBootstrap(bootstrap) {
  try {
    return await bootstrap();
  } catch {
    return SAFE_UNAVAILABLE_OUTPUT;
  }
}

async function bootstrapOperatorInspector() {
  // Local operator adapter only. Next normally resolves both the @/ alias and
  // its virtual server-only marker. Source-level server-only imports remain.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export {};", shortCircuit: true };
      }
      if (specifier.startsWith("@/")) {
        const basePath = path.join(projectRoot, "src", specifier.slice(2));
        const resolvedPath = [basePath, `${basePath}.ts`, `${basePath}.tsx`]
          .find((candidate) => existsSync(candidate));
        if (!resolvedPath) throw new Error("OPERATOR_MODULE_UNAVAILABLE");
        return { url: pathToFileURL(resolvedPath).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });

  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(projectRoot);

  const { runReconciliationInspectorCli } = await import(
    "../src/modules/integrations/gmail/domain/reconciliation-inspector-cli.ts"
  );
  return runReconciliationInspectorCli(process.argv.slice(2), {
    list: async (input) => {
      const { listSendReconciliationCandidates } = await import(
        "../src/modules/integrations/gmail/server/list-send-reconciliation-candidates.ts"
      );
      return listSendReconciliationCandidates(input);
    },
    inspect: async (input) => {
      const { evaluateAmbiguousSendReconciliation } = await import(
        "../src/modules/integrations/gmail/server/evaluate-ambiguous-send-reconciliation.ts"
      );
      return evaluateAmbiguousSendReconciliation(input);
    },
  });
}

const isDirectInvocation = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectInvocation) {
  const output = await runSafeOperatorBootstrap(bootstrapOperatorInspector);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (output.status === "INVALID_INPUT" || output.status === "UNAVAILABLE") {
    process.exitCode = 1;
  }
}
