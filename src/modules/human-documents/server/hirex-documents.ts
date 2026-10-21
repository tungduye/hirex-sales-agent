import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import { HIREX_ROOT_FOLDER } from "../core/hirex-documents";
import type { HumanDocument } from "../core/retrieval";

// Tài liệu HireX (documents members asked Soda to keep), shown in the library next to the Human copy. Read
// with the server client after the caller checked "Tài liệu · Xem"; cached a minute per workspace and
// refreshed at once after a save.

const cache = new Map<string, { at: number; documents: HumanDocument[]; stamp: string }>();
const TTL = 60_000;

/** The workspace's HireX documents as library documents (folder "Tài liệu HireX" › <thư mục>), plus a version stamp. */
export async function loadHirexDocuments(workspaceId: string): Promise<{ documents: HumanDocument[]; stamp: string }> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const { data, error } = await createPrivilegedClient().from("hirex_documents").select("id,title,folder,content_html,updated_at")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: true }).limit(2000);
  if (error) return hit ?? { documents: [], stamp: "none" };
  const rows = data ?? [];
  const documents = rows.map((row) => ({ id: Number(row.id), name: String(row.title), group: String(row.folder), status: String(row.content_html), folderPath: [HIREX_ROOT_FOLDER, String(row.folder)] }));
  const stamp = `${rows.length}:${rows.reduce((latest, row) => (String(row.updated_at) > latest ? String(row.updated_at) : latest), "")}`;
  const value = { at: Date.now(), documents, stamp };
  cache.set(workspaceId, value);
  return value;
}

export function forgetHirexDocuments(workspaceId: string) { cache.delete(workspaceId); }

/** Folders already used, for the Trợ lý to reuse a name instead of making near-duplicates. */
export async function hirexFolders(workspaceId: string) {
  const { documents } = await loadHirexDocuments(workspaceId);
  return [...new Set(documents.map((document) => document.group))];
}

export async function saveHirexDocument(input: { workspaceId: string; userId: string; title: string; folder: string; html: string; chars: number; source: "WEB" | "ZALO" }) {
  const { data, error } = await createPrivilegedClient().from("hirex_documents").insert({
    workspace_id: input.workspaceId, title: input.title, folder: input.folder, content_html: input.html, content_chars: input.chars, source: input.source, created_by: input.userId,
  }).select("id").single();
  if (error || !data) throw new Error("DOCUMENT_SAVE_FAILED");
  forgetHirexDocuments(input.workspaceId);
  return Number(data.id);
}
