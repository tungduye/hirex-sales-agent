import { spawn, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash, createHmac } from "node:crypto";
import { connect } from "node:net";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = "C:\\Users\\Admin\\AppData\\Local\\HireX\\ZaloRuntime";
const deplaoRoot = "C:\\Users\\Admin\\deplao-hirex-fork";
const adapterRoot = "C:\\Users\\Admin\\hirex-deplao-adapter";
const profile = path.join(runtime, "deplao-qa-profile");
const logs = path.join(runtime, "supervisor-logs");
const stateRoot = path.join(root, "runtime");
const statePath = path.join(stateRoot, "deplao-supervisor-state.json");
const lockPath = path.join(stateRoot, "deplao-supervisor.lock");
const ports = [18788, 18789, 18790];
const since = "2026-09-24T07:50:00.000Z";
const maximumAdditionalAccounts = 24;

// Pass explicit environment to remove empty Windows test flag entries too.
export function cleanRuntimeEnvironment(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => ![
    "HIREX_REAL_INBOUND_ONE_SHOT_EVENT_ID", "HIREX_SESSIONLESS_TEST", "HIREX_QA_BOOT_TEST", "ELECTRON_RUN_AS_NODE",
  ].includes(key.toUpperCase())));
}
// Built output the two runtime processes load. After "npm run build" / "npm run build:electron" these files
// change; the running processes keep the old code until restarted, so the supervisor restarts them itself.
const buildMarkers = [
  path.join(adapterRoot, "dist", "src", "app.js"),
  path.join(adapterRoot, "dist", "src", "domain", "send-service.js"),
  path.join(deplaoRoot, "dist-electron", "electron", "main.js"),
  path.join(deplaoRoot, "dist-electron", "electron", "hirex-binding", "index.js"),
];
/** Newest modification time among the build outputs (0 when none can be read). */
export function newestBuildTime(files = buildMarkers, stat = statSync) {
  let newest = 0;
  for (const file of files) { try { newest = Math.max(newest, stat(file).mtimeMs); } catch { /* missing during a build */ } }
  return newest;
}
/** Restart only for a build newer than the running processes, and only once it has been quiet for a while (finished writing). */
export function shouldRestartForBuild(newest, startedAt, now, quietMs = 20000) {
  return newest > startedAt && now - newest >= quietMs;
}
function log(event, fields = {}) { console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields })); }
function atomicJson(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(data)); renameSync(temporary, file);
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function portOpen(port) {
  return new Promise(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (ok) => { socket.destroy(); resolve(ok); };
    socket.once("connect", () => finish(true)); socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}
function readAccounts() {
  const db = new DatabaseSync(path.join(profile, "deplao-tool.db"), { readOnly: true });
  try { return db.prepare("select zalo_id,full_name,channel,is_active,listener_active from accounts where is_active=1 and channel='zalo' order by created_at").all(); }
  finally { db.close(); }
}
function startChild(command, args, cwd, label, env) {
  const stdout = openSync(path.join(logs, `${label}.stdout.log`), "a");
  const stderr = openSync(path.join(logs, `${label}.stderr.log`), "a");
  try {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", stdout, stderr] });
    child.on("error", () => log("CHILD_START_FAILED", { label }));
    return child;
  } finally { closeSync(stdout); closeSync(stderr); }
}
function stopChild(child) {
  if (!child?.pid || child.exitCode !== null) return;
  // Stop only exact child trees created by this supervisor.
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
}
async function accountHealth(id, env) {
  const endpoint = `/v1/accounts/${encodeURIComponent(id)}/health`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const canonical = ["GET", endpoint, timestamp, createHash("sha256").update("").digest("hex"), ""].join("\n");
  const signature = createHmac("sha256", env.HIREX_BRIDGE_SIGNING_SECRET).update(canonical).digest("hex");
  try {
    const response = await fetch(`http://127.0.0.1:${env.ADAPTER_PORT || "18788"}${endpoint}`, { headers: { "x-hirex-timestamp": timestamp, "x-hirex-signature": signature }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return "UNKNOWN";
    return (await response.json()).status ?? "UNKNOWN";
  } catch { return "UNKNOWN"; }
}

async function main() {
  mkdirSync(logs, { recursive: true }); mkdirSync(stateRoot, { recursive: true });
  if (existsSync(lockPath)) {
    const previousPid = Number(readFileSync(lockPath, "utf8"));
    if (Number.isSafeInteger(previousPid) && previousPid > 0 && alive(previousPid)) throw Error("SUPERVISOR_ALREADY_RUNNING");
    unlinkSync(lockPath);
  }
  writeFileSync(lockPath, String(process.pid), { flag: "wx" });
  const env = cleanRuntimeEnvironment(process.env);
  env.HIREX_AI_AUTOMATION_ENABLED = "true";
  for (const name of ["HIREX_BRIDGE_SIGNING_SECRET", "DEPLAO_INTERNAL_SHARED_SECRET", "HIREX_ZALO_QA_ACCOUNT_ID"]) {
    if (!env[name]) throw Error(`CONFIGURATION_MISSING_${name}`);
  }
  let accounts = readAccounts();
  const policiesPath = path.join(stateRoot, "deplao-inbound-cutovers.json");
  const cutovers = existsSync(policiesPath) ? JSON.parse(readFileSync(policiesPath, "utf8")) : {};
  function policies() {
    for (const account of accounts) cutovers[account.zalo_id] ??= since;
    atomicJson(policiesPath, cutovers);
    const additional = accounts.filter(account => account.zalo_id !== env.HIREX_ZALO_QA_ACCOUNT_ID)
      .map(account => ({ accountId: account.zalo_id, cutoverAt: cutovers[account.zalo_id] }));
    if (additional.length > maximumAdditionalAccounts) throw Error("TOO_MANY_DEPLAO_ZALO_ACCOUNTS");
    env.HIREX_ZALO_ADDITIONAL_INBOUND_ACCOUNTS = JSON.stringify(additional);
    atomicJson(path.join(stateRoot, "deplao-zalo-accounts.json"), accounts);
  }
  policies();
  if ((await Promise.all(ports.map(portOpen))).some(Boolean)) throw Error("EXISTING_RUNTIME_REQUIRES_CONTROLLED_HANDOFF");
  let adapter, deplao, startedAt, lastRestart = 0;
  const jobs = new Map();
  function startRuntime() {
    startedAt = Date.now();
    adapter = startChild(process.execPath, [path.join(adapterRoot, "dist/src/app.js")], adapterRoot, "adapter", env);
    deplao = startChild(path.join(deplaoRoot, "node_modules/electron/dist/electron.exe"), ["."], deplaoRoot, "deplao", env);
    log("RUNTIME_STARTED", { adapterPid: adapter.pid, deplaoPid: deplao.pid });
  }
  function schedule(label, script, args = [], timeoutMs = 300000) {
    const previous = jobs.get(label);
    if (previous && previous.child.exitCode === null) {
      if (Date.now() - previous.at > timeoutMs) { stopChild(previous.child); log("WORKER_TIMEOUT", { label }); }
      return;
    }
    const child = startChild(process.execPath, [path.join(root, "scripts", script), ...args], root, label, env);
    jobs.set(label, { child, at: Date.now() });
    child.once("exit", code => { if (code) log("WORKER_RETRY_PENDING", { label, code }); });
  }
  startRuntime();
  if (process.argv.includes("--once")) {
    adapter.unref(); deplao.unref(); unlinkSync(lockPath); return;
  }
  let stopping = false;
  const cleanup = () => {
    if (stopping) return; stopping = true;
    for (const { child } of jobs.values()) stopChild(child);
    stopChild(deplao); stopChild(adapter);
    if (existsSync(lockPath)) unlinkSync(lockPath);
    process.exit(0);
  };
  process.on("SIGINT", cleanup); process.on("SIGTERM", cleanup);
  let lastSync = 0, lastHealth = 0, currentHealth = [];
  for (;;) {
    const now = Date.now();
    const listening = await Promise.all(ports.map(portOpen));
    if (now - lastRestart > 30000 && shouldRestartForBuild(newestBuildTime(), startedAt, now)) {
      log("RUNTIME_RESTART_NEW_BUILD", { adapterPid: adapter.pid, deplaoPid: deplao.pid });
      stopChild(deplao); stopChild(adapter); lastRestart = now;
      await new Promise(resolve => setTimeout(resolve, 1500)); startRuntime();
      continue;
    }
    if (now - startedAt > 60000 && now - lastRestart > 120000 && (!listening.every(Boolean) || adapter.exitCode !== null || deplao.exitCode !== null)) {
      stopChild(deplao); stopChild(adapter); lastRestart = now;
      await new Promise(resolve => setTimeout(resolve, 1500)); startRuntime();
    }
    if (now - lastSync > 30000) {
      lastSync = now;
      const nextAccounts = readAccounts();
      const changed = nextAccounts.map(a => a.zalo_id).join(",") !== accounts.map(a => a.zalo_id).join(",");
      accounts = nextAccounts; policies();
      if (changed) { stopChild(deplao); stopChild(adapter); await new Promise(resolve => setTimeout(resolve, 1500)); startRuntime(); }
      schedule("account-sync", "sync-deplao-zalo-accounts.mjs", [], 60000);
      if (env.HIREX_FACEBOOK_PROFILE_BRIDGE_ENABLED === "true")
        schedule("facebook-history-sync", "sync-deplao-facebook-history.mjs", ["--apply"], 120000);
      if (existsSync(path.join(root, "scripts/sync-zalo-recent-messages.mjs")))
        schedule("recent-message-sync", "sync-zalo-recent-messages.mjs", ["--once", `--since=${since}`]);
      if (existsSync(path.join(stateRoot, "zalo-media-sync-authorized")))
        schedule("attachment-sync", "sync-zalo-live-attachments.mjs");
    }
    if (now - lastHealth > 30000 && listening.every(Boolean)) {
      lastHealth = now;
      currentHealth = await Promise.all(accounts.map(async account => ({ accountId: account.zalo_id, name: account.full_name, status: await accountHealth(account.zalo_id, env) })));
    }
    atomicJson(statePath, { pid: process.pid, at: new Date().toISOString(), adapterPid: adapter.pid, deplaoPid: deplao.pid, ports: ports.map((port,i) => ({ port, listening: listening[i] })), accounts: currentHealth });
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { log("SUPERVISOR_FAILED", { code: /^[A-Z_]+$/u.test(error.message) ? error.message : "RUNTIME_ERROR" }); process.exit(1); });
}
