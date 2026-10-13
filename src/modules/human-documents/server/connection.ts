import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { requireWorkspaceAdmin } from "@/modules/access/server/access-control";
import { encryptCredential, decryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";

// Operator-controlled destination: never accept an arbitrary credential recipient from a form.
export function humanEndpoint() {
  const value = process.env.HUMAN_API_BASE_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch { return null; }
}

type Connection = { endpoint: string; username: string; password: string; verifiedAt: string };
function connectionPath(workspaceId: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(workspaceId)) throw new Error("INVALID_WORKSPACE");
  return join(process.cwd(), "runtime", "human-connections", `${workspaceId}.enc`);
}

export async function connectionSummary() {
  const account = await requireWorkspaceAdmin();
  const endpoint = humanEndpoint();
  try {
    const value = JSON.parse(decryptCredential(await readFile(connectionPath(account.workspaceId), "utf8"))) as Connection;
    return { endpoint, username: value.username, verifiedAt: value.endpoint === endpoint ? value.verifiedAt : null, loadError: false };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { endpoint, username: "", verifiedAt: null, loadError: !missing };
  }
}

export async function verifyAndStoreHumanConnection(username: string, password: string) {
  const account = await requireWorkspaceAdmin();
  const endpoint = humanEndpoint();
  if (!endpoint) throw new Error("ENDPOINT_NOT_READY");
  // Verify encryption availability before sending credentials to the approved destination.
  const encrypted = encryptCredential(JSON.stringify({ endpoint, username, password, verifiedAt: new Date().toISOString() }));
  const response = await fetch(`${endpoint}/auth/login`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error("AUTH_FAILED");
  const result = await response.json();
  if (typeof result?.accessToken !== "string" || !result.accessToken) throw new Error("AUTH_FAILED");
  // Neither the upstream token nor the raw response is persisted or returned to the browser.
  const destination = connectionPath(account.workspaceId);
  await mkdir(join(process.cwd(), "runtime", "human-connections"), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, encrypted, { mode: 0o600, flag: "wx" });
  await rename(temporary, destination);
}
