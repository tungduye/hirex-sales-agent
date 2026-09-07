import { resolve } from "node:path";
import { loadPhase4cQaEnv } from "./load-phase4c-qa-env.mjs";

const EMAIL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isNormalEmailAddress(value) {
  if (value.length > 254) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@") || at > 64) return false;
  return EMAIL_PATTERN.test(value);
}

export function parseQaRecipientAllowlist(rawValue) {
  if (typeof rawValue !== "string") throw new Error("QA_ALLOWLIST_INVALID");

  const entries = [...new Set(
    rawValue
      .split(/[;,]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )];

  if (entries.length === 0 || entries.some((email) => !isNormalEmailAddress(email))) {
    throw new Error("QA_ALLOWLIST_INVALID");
  }

  return Object.freeze(entries);
}

export function loadQaRecipientAllowlist(projectRoot = resolve(import.meta.dirname, "..")) {
  const environment = loadPhase4cQaEnv(projectRoot);
  if (environment.missing.length > 0) throw new Error("QA_ALLOWLIST_INVALID");
  return parseQaRecipientAllowlist(process.env.HIREX_QA_RECIPIENT_ALLOWLIST);
}
