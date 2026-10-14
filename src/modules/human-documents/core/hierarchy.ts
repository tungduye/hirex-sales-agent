export type TreeEntry = { id: number; name: string; group: string; groupId?: number; folderPath?: string[] };
export type DocumentFolder = { key: string; name: string; children: DocumentFolder[]; documents: TreeEntry[] };
const vh1 = "Vận Hành 1 (VH1)_Báo cáo (BC)";
const vh2 = "Vận Hành 2 (VH2)_Mẫu_Tài liệu_Quy Trình";
const vh3 = "Vận Hành 3 (VH3)_Tài nguyên gốc";
const bc03 = "Bộ phận_BC03 (30K_1 lần)_VH1";
const bc02 = "Bộ phận_BC02 (50K_1 lần)_VH1";
const bc01 = "Bộ phận_BC01 (100k_1 lần)_VH1";
const bht = "Đề tài_BC03_ Ban Hỗ Trợ (BHT)_VH1";
// Only relationships visible in the user's reference images are registered here.
const paths = new Map<string, string[]>();
function register(path: string[]) { paths.set(path.at(-1)!, path); }
register([vh1]);
for (const [department, topics] of [
  [bc03, [bht, "Đề tài_BC03_Kế toán/HR_VH1", "Đề tài_BC03_R&D_VH1", "Đề tài_BC03_Rec_VH1", "Đề tài_BC03_Sale_VH1", "Đề tài_BC03_AM_VH1"]],
  [bc02, ["Đề tài_BC02_Ban Hỗ Trợ (BHT)_VH1", "Đề tài_BC02_R&D_VH1", "Đề tài_BC02_Kế toán/HR_VH1", "Đề tài_BC02_Rec_VH1", "Đề tài_BC02_Sale_VH1", "Đề tài_BC02_AM_VH1"]],
  [bc01, ["Đề tài_BC01_VH1_Avenger", "Đề tài_BC01_VH1_Tuần"]],
] as [string, string[]][]) {
  register([vh1, department]);
  for (const topic of topics) register([vh1, department, topic]);
}
for (const subject of ["Môn_BC03_ Ban Hỗ Trợ (BHT)_VH1_Giao Task", "Môn_BC03_Ban Hỗ Trợ (BHT)_VH1"]) register([vh1, bc03, bht, subject]);
for (const subject of ["Môn_Trang R&D", "Môn_Toản R&D", "Môn_Tùng Leader R&D"]) register([vh1, bc03, "Đề tài_BC03_R&D_VH1", subject]);
register([vh2]);
for (const department of ["Bộ phận_HR_VH2", "Bộ phận_Sale_VH2", "Bộ phận_AM_VH2", "Bộ phận_R&D_VH2", "Bộ phận_KTHC_VH2", "Bộ phận_Rec Dự án_VH2"]) register([vh2, department]);
register([vh3]);
for (const department of ["Bộ phận_KIT_R&D", "Bộ phận_Tài liệu_chưa phân bổ_KTHC_VH3", "Bộ phận_BC Pending_VH3", "Dữ liệu chưa phận loại - vận hành (Rec/AM)"]) register([vh3, department]);

export function documentFolderPath(group: string): string[] {
  return paths.get(group) ?? ["Chưa xác định thư mục cha", group];
}
export function documentsForFolderQuery<T extends TreeEntry>(documents: T[], query: string) {
  const normalizeQuery = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/\s+/g, " ").trim();
  const normalizeGroup = (value: string) => normalizeQuery(value).replace(/[_/]+/g, " ").replace(/\s+/g, " ").trim();
  const wanted = normalizeQuery(query).replace(/^(?:(?:de tai|bo phan|mon)\s+)+/, "");
  const queryAliases = new Set([wanted, normalizeQuery(query)]);
  if (!wanted) return null;
  const nodes = new Map<string, { path: string[]; name: string }>();
  for (const doc of documents) {
    const path = doc.folderPath ?? documentFolderPath(doc.group);
    path.forEach((name, index) => {
      const normalized = normalizeQuery(name);
      if ([...queryAliases].some(alias => normalized.includes(alias) || normalized.replace(/^(?:(?:de tai|bo phan|mon)\s+)+/, "").includes(alias))) nodes.set(JSON.stringify(path.slice(0, index + 1)), { path: path.slice(0, index + 1), name });
    });
  }
  if (normalizeQuery(query).includes("bc03_r&d")) {
    const name = "Đề tài_BC03_R&D_VH1";
    const groups = ["Môn_Trang R&D", "Môn_Toản R&D", "Môn_Tùng Leader R&D"].map(normalizeGroup);
    return { name, documents: documents.filter(doc => {
      const group = normalizeGroup(doc.group);
      return groups.some(parent => group === parent || group.startsWith(`${parent} `));
    }) };
  }
  if (!nodes.size) return null;
  const candidates = [...nodes.values()].sort((a, b) => a.path.length - b.path.length);
  const shallowest = candidates.filter(node => node.path.length === candidates[0].path.length);
  if (shallowest.length !== 1) return null;
  const path = shallowest[0].path;
  return { name: shallowest[0].name, documents: documents.filter(doc => {
    const candidatePath = doc.folderPath ?? documentFolderPath(doc.group);
    return path.every((part, index) => candidatePath[index] === part);
  }) };
}
export function buildDocumentTree(documents: TreeEntry[], folderPaths?: string[][]): DocumentFolder[] {
  const roots: DocumentFolder[] = [];
  const nodes = new Map<string, DocumentFolder>();
  // Preserve source ordering from the reference, including intermediate folders.
  function ensure(path: string[]) {
    let children = roots;
    let node: DocumentFolder | undefined;
    path.forEach((name, index) => {
      const key = JSON.stringify(path.slice(0, index + 1));
      node = nodes.get(key);
      if (!node) { node = { key, name, children: [], documents: [] }; nodes.set(key, node); children.push(node); }
      children = node.children;
    });
    return node!;
  }
  for (const path of folderPaths ?? paths.values()) ensure(path);
  for (const doc of documents) ensure(doc.folderPath ?? documentFolderPath(doc.group)).documents.push(doc);
  function prune(items: DocumentFolder[]): DocumentFolder[] {
    return items.map(node => ({ ...node, children: prune(node.children) })).filter(node => node.documents.length || node.children.length);
  }
  // Human's root display order is independent of the first child returned by API.
  const rootRank = (name: string) => {
    const match = name.match(/^Vận\s+Hành\s+([123])\s*\(VH[123]\)/iu);
    return match ? Number(match[1]) : 4;
  };
  return prune(roots).sort((a, b) => rootRank(a.name) - rootRank(b.name));
}
