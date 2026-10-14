export const HUMAN_DOCUMENT_URL = "http://52.220.196.215:8088/document/all";
export const HUMAN_FOLDER_URL = "http://52.220.196.215:8088/masterdata/group_document?sort=masterId,asc";
export function parseHumanFolders(value: unknown) {
  const response = value as { code?: unknown; data?: unknown } | null;
  if (response?.code !== 200 || !Array.isArray(response.data) || !response.data.length) throw Error("INVALID_FOLDERS");
  const folders = new Map<number, { id: number; name: string; parent: number | null }>();
  for (const row of response.data) {
    if (!Number.isSafeInteger(row?.masterId) || typeof row.masterName !== "string" || !row.masterName.trim() || folders.has(row.masterId) || (row.parent != null && !Number.isSafeInteger(row.parent))) throw Error("INVALID_FOLDER");
    folders.set(row.masterId, { id: row.masterId, name: row.masterName, parent: row.parent });
  }
  const paths = new Map<number, string[]>();
  function visit(id: number, seen = new Set<number>()): string[] {
    if (paths.has(id)) return paths.get(id)!;
    const folder = folders.get(id);
    if (!folder || seen.has(id) || seen.size > 50) throw Error("INVALID_FOLDER_PARENT");
    seen.add(id);
    const path = [...(folder.parent == null || folder.parent === 0 ? [] : visit(folder.parent, seen)), folder.name];
    paths.set(id, path); return path;
  }
  for (const id of folders.keys()) visit(id);
  return { paths, order: [...folders.keys()] };
}
export const HUMAN_DOCUMENT_FILTER = { keyword: null, empName: null, docName: null, startDate: null, endDate: null, groupId: null, rateAmId: null, rateAmId2: null, sort: ["docId,desc"] };
export function parseHumanSnapshot(value: unknown) {
  const response = value as { code?: unknown; type?: unknown; data?: unknown } | null;
  if (!response || response.code !== 200 || response.type !== "ok" || !Array.isArray(response.data) || !response.data.length || response.data.length > 20000) throw Error("INVALID_RESPONSE");
  const ids = new Set<number>();
  return response.data.map((row: Record<string, unknown>) => {
    if (!row || !Number.isSafeInteger(row.docId) || Number(row.docId) <= 0 || ids.has(Number(row.docId)) || typeof row.docName !== "string" || !row.docName.trim() || (row.status != null && typeof row.status !== "string")) throw Error("INVALID_DOCUMENT");
    ids.add(Number(row.docId));
    return { id: Number(row.docId), name: row.docName, group: String(row.groupDocument ?? row.groupName ?? "Chưa phân nhóm"), status: (row.status ?? "") as string, ...(Number.isSafeInteger(row.groupId) ? { groupId: Number(row.groupId) } : {}) };
  });
}
