#!/usr/bin/env node
import { loadPhase4cQaEnv } from "./load-phase4c-qa-env.mjs";

loadPhase4cQaEnv();
const raw = process.env.SUPABASE_DB_URL?.trim() ?? "";
let parsed = null;
try { parsed = new URL(raw); } catch {}

const diagnostics = {
  present: raw.length > 0,
  urlParseable: parsed !== null,
  postgresProtocol: parsed?.protocol === "postgresql:" || parsed?.protocol === "postgres:",
  usernamePresent: Boolean(parsed?.username),
  passwordPresent: Boolean(parsed?.password),
  hostnamePresent: Boolean(parsed?.hostname),
  portPresent: Boolean(parsed?.port),
  databasePathPresent: Boolean(parsed?.pathname && parsed.pathname !== "/"),
  containsWhitespace: /\s/.test(raw),
  containsPlaceholder: /YOUR[-_ ]?PASSWORD|PASSWORD_HERE|PROJECT[-_ ]?REF|\{[^}]+\}|<[^>]+>/i.test(raw),
  startsWithQuote: /^['"]/.test(raw),
  endsWithQuote: /['"]$/.test(raw),
  atSignCount: (raw.match(/@/g) ?? []).length,
  schemeDelimiterPresent: raw.includes("://"),
  alternativeDatabaseUrlPresent: Boolean(process.env.DATABASE_URL?.trim()),
  databasePasswordVariablePresent: Boolean(process.env.SUPABASE_DB_PASSWORD?.trim() || process.env.POSTGRES_PASSWORD?.trim()),
};

for (const [key, value] of Object.entries(diagnostics)) console.log(`SUPABASE_DB_URL_${key}=${value}`);
