import "server-only";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { encryptCredential, decryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";
import { HUMAN_DOCUMENT_URL, HUMAN_FOLDER_URL, HUMAN_DOCUMENT_FILTER, parseHumanSnapshot, parseHumanFolders } from "../core/api-snapshot";
function paths(workspace: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(workspace)) throw Error("INVALID_WORKSPACE");
  const folder = join(process.cwd(), "runtime", "human-documents");
  return { folder, snapshot: join(folder, `${workspace}.enc`), token: join(folder, `${workspace}.api-token.enc`) };
}
async function atomicSave(file: string, text: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text, { flag: "wx", mode: 0o600 }); await rename(temporary, file); }
  finally { await unlink(temporary).catch(() => {}); }
}
export async function storeHumanApiToken(workspace: string, token: string) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 8192) throw Error("INVALID_TOKEN");
  const p = paths(workspace); const encrypted = encryptCredential(token);
  await mkdir(p.folder, { recursive: true, mode: 0o700 }); await atomicSave(p.token, encrypted);
}
/** The Human API token saved in "Cài đặt API Human" (shared by Tài liệu and Khách hàng); null when none is saved. */
export async function readHumanApiToken(workspace: string): Promise<string | null> {
  try { return decryptCredential(await readFile(paths(workspace).token, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
const running = new Set<string>();
export async function syncHumanApi(workspace: string) {
  if (running.has(workspace)) throw Error("SYNC_BUSY");
  running.add(workspace);
  try {
    const p = paths(workspace); const token = decryptCredential(await readFile(p.token, "utf8"));
    const response = await fetch(HUMAN_DOCUMENT_URL, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60000),
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(HUMAN_DOCUMENT_FILTER) });
    if (!response.ok || !response.body) throw Error("UPSTREAM_FAILED");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 32 * 1024 * 1024) throw Error("RESPONSE_TOO_LARGE"); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => {}); }
    const raw = Buffer.concat(chunks).toString("utf8");
    const folderResponse = await fetch(HUMAN_FOLDER_URL, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}` } });
    if (!folderResponse.ok) throw Error("FOLDERS_FAILED");
    const folders = parseHumanFolders(await folderResponse.json());
    const documents = parseHumanSnapshot(JSON.parse(raw)).map(doc => {
      const folderPath = doc.groupId == null ? undefined : folders.paths.get(doc.groupId);
      if (!folderPath) throw Error("DOCUMENT_FOLDER_MISSING");
      return { ...doc, group: folderPath.at(-1)!, folderPath };
    });
    const folderPaths = folders.order.map(id => folders.paths.get(id)!);
    const encrypted = encryptCredential(JSON.stringify({ importedAt: new Date().toISOString(), sourceSha256: createHash("sha256").update(raw).digest("hex"), documents, folderPaths }));
    try { const previous = await readFile(p.snapshot, "utf8"); await atomicSave(`${p.snapshot}.previous`, previous); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await atomicSave(p.snapshot, encrypted); return documents.length;
  } finally { running.delete(workspace); }
}
