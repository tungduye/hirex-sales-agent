import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");

export const REMOTE_READ_FLAG = "HIREX_ALLOW_REMOTE_READ_TESTS";

export function isRemoteReadAuthorized(environment = process.env) {
  return environment[REMOTE_READ_FLAG]?.trim() === "1";
}

export function loadRemoteReadAuthorization(projectRoot = path.resolve(import.meta.dirname, ".."), environment = process.env) {
  loadEnvConfig(projectRoot);
  return isRemoteReadAuthorized(environment);
}

export async function runRemoteReadBoundary({ environment = process.env, connect }) {
  if (!isRemoteReadAuthorized(environment)) return { mode: "LOCAL", connected: false };
  await connect();
  return { mode: "REMOTE", connected: true };
}
