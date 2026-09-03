#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
if(process.env.HIREX_ENABLE_CAMPAIGN_WORKER_OPERATOR!=="1") {process.stdout.write('{"success":false,"code":"OPERATOR_DISABLED"}\n');process.exitCode=1;}
else try{
  const require=createRequire(import.meta.url);require("@next/env").loadEnvConfig(root);
  registerHooks({resolve(specifier,context,nextResolve){if(specifier==="server-only")return{url:"data:text/javascript,export {};",shortCircuit:true};if(specifier.startsWith("@/")){const base=path.join(root,"src",specifier.slice(2));const found=[base,`${base}.ts`,`${base}.tsx`].find(existsSync);if(!found)throw new Error("MODULE_UNAVAILABLE");return{url:pathToFileURL(found).href,shortCircuit:true};}return nextResolve(specifier,context);}});
  const worker=await import("../src/modules/campaigns/server/process-email-campaign-batch.ts");
  const campaignsActivated=await worker.activateDueEmailCampaigns();const batch=await worker.processEmailCampaignBatch(10);
  process.stdout.write(`${JSON.stringify({campaignsActivated,...batch})}\n`);
}catch{process.stdout.write('{"success":false,"code":"WORKER_UNAVAILABLE"}\n');process.exitCode=1;}
