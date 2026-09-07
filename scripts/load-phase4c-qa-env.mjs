import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");

export const QA_ENV_NAMES = [
  "SUPABASE_DB_URL",
  "HIREX_ALLOW_REMOTE_SYNTHETIC_TESTS",
  "HIREX_QA_SENDER_EMAIL",
  "HIREX_QA_RECIPIENT_ALLOWLIST",
  "HIREX_QA_MAX_LIVE_SENDS",
  "HIREX_QA_CAMPAIGN_PREFIX",
];

export function loadPhase4cQaEnv(projectRoot = resolve(import.meta.dirname, "..")) {
  loadEnvConfig(projectRoot);
  const missing = QA_ENV_NAMES.filter((name) => !process.env[name]?.trim());
  if (missing.length === 0) {
    console.log("QA_CONFIG: 6/6 PRESENT");
  } else {
    for (const name of missing) console.error(`QA_CONFIG_MISSING: ${name}`);
  }
  return { missing, projectRoot };
}
