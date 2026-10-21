import "server-only";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import sanitizeHtml from "sanitize-html";
import { requireDocumentReader } from "@/modules/access/server/access-control";
import { decryptCredential } from "@/modules/integrations/gmail/server/credential-encryption";
import { normalize, documentIndex } from "../core/retrieval";
import { VersionCache } from "../core/version-cache";
import { loadHirexDocuments } from "./hirex-documents";

type Document = { id: number; name: string; group: string; status: string; groupId?: number; folderPath?: string[] };
type Snapshot = { importedAt: string; documents: Document[]; folderPaths?: string[][] };
const snapshots = new VersionCache<Snapshot>();

/** The library: the copy imported from Human plus the Tài liệu HireX that members asked Soda to keep. */
export async function loadHumanSnapshot(): Promise<Snapshot | null> {
  const account = await requireDocumentReader();
  if (!/^[a-zA-Z0-9-]+$/.test(account.workspaceId)) throw new Error("INVALID_WORKSPACE");
  const [human, local] = await Promise.all([loadHumanFile(account.workspaceId), loadHirexDocuments(account.workspaceId)]);
  if (!local.documents.length) return human;
  // Same merged array while neither part changed, so the search index built on it is reused.
  const cached = merged.get(account.workspaceId);
  if (cached && cached.human === human && cached.stamp === local.stamp) return cached.snapshot;
  const snapshot: Snapshot = { importedAt: human?.importedAt ?? new Date().toISOString(), documents: [...(human?.documents ?? []), ...local.documents], folderPaths: human?.folderPaths };
  merged.set(account.workspaceId, { human, stamp: local.stamp, snapshot });
  return snapshot;
}

const merged = new Map<string, { human: Snapshot | null; stamp: string; snapshot: Snapshot }>();

async function loadHumanFile(workspaceId: string): Promise<Snapshot | null> {
  try {
    const file = join(process.cwd(), "runtime", "human-documents", `${workspaceId}.enc`);
    const info = await stat(file);
    const version = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    return await snapshots.get(workspaceId, version, async () => {
      const encrypted = await readFile(file, "utf8");
      const after = await stat(file);
      if (`${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}` !== version) throw new Error("SNAPSHOT_CHANGED_RETRY");
      return JSON.parse(decryptCredential(encrypted)) as Snapshot;
    });
  } catch (error) {
    snapshots.delete(workspaceId);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Không đọc được dữ liệu tài liệu. Liên hệ quản trị viên.");
  }
}

export async function readHumanDocuments(query: string, page: number, selectedId?: number, group = "") {
  const snapshot = await loadHumanSnapshot();
  if (!snapshot) return null;
  const needle = normalize(query.trim());
  const pool = group ? snapshot.documents.filter(doc => doc.group === group) : snapshot.documents;
  const matches = needle ? documentIndex(snapshot.documents).filter(item => (!group || item.document.group === group) && item.search.includes(needle)).map(item => item.document) : pool;
  const pages = Math.max(1, Math.ceil(matches.length / 30));
  const currentPage = Math.min(Math.max(1, page), pages);
  const selected = selectedId ? snapshot.documents.find(doc => doc.id === selectedId) : undefined;
  return {
    importedAt: snapshot.importedAt, total: snapshot.documents.length, matched: matches.length, pages, currentPage,
    groups: [...new Set(snapshot.documents.map(doc => doc.group))].sort((a,b) => a.localeCompare(b,"vi")),
    folderPaths: snapshot.folderPaths,
    treeDocuments: matches.map(({ id, name, group, groupId, folderPath }) => ({ id, name, group, groupId, folderPath })),
    documents: matches.slice((currentPage - 1) * 30, currentPage * 30).map(({ id, name, group }) => ({ id, name, group })),
    selected: selected ? { ...selected, status: sanitizeHtml(selected.status, {
      allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "table", "tbody", "thead", "tr", "td", "th"],
      allowedAttributes: {},
    }) } : null,
  };
}
