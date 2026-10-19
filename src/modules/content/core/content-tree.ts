// Folder tree for Kho mẫu / Content đã tạo, like the Tài liệu screen: Bộ phận › Phân loại › Định dạng,
// each with how many entries it holds. Pure module (unit-tested in tests/content-tree.test.mjs).

export interface TreeEntryLike { department: string; categoryId: string | null; format: string | null }
export interface TreeFilter { department?: string; category?: string; format?: string }
export interface TreeNode { key: string; label: string; count: number; depth: number; filter: TreeFilter; hidden?: boolean; children: TreeNode[] }

/** "NONE" stands for "Chưa phân loại". */
export const NO_CATEGORY = "NONE";

export function matchesFilter(entry: TreeEntryLike, filter: TreeFilter) {
  return (!filter.department || entry.department === filter.department)
    && (!filter.category || (filter.category === NO_CATEGORY ? !entry.categoryId : entry.categoryId === filter.category))
    && (!filter.format || (entry.format ?? "POST_LONG") === filter.format);
}

export function buildContentTree(entries: TreeEntryLike[], lists: {
  departments: Array<{ code: string; label: string; active: boolean }>;
  formats: Array<{ code: string; label: string }>;
  categories: Array<{ id: string; department: string; name: string; active: boolean; sort: number }>;
}): TreeNode[] {
  const formatsOf = (filter: TreeFilter, depth: number, parentKey: string): TreeNode[] => {
    const inFolder = entries.filter((entry) => matchesFilter(entry, filter));
    return lists.formats.flatMap((format) => {
      const count = inFolder.filter((entry) => (entry.format ?? "POST_LONG") === format.code).length;
      return count ? [{ key: `${parentKey}/${format.code}`, label: format.label, count, depth, filter: { ...filter, format: format.code }, children: [] }] : [];
    });
  };
  // Departments with entries come first in settings order; unknown codes found in the data are kept too.
  const codes = [...lists.departments.map((item) => item.code), ...new Set(entries.map((entry) => entry.department))].filter((code, index, all) => all.indexOf(code) === index);
  return codes.flatMap((code) => {
    const department = lists.departments.find((item) => item.code === code);
    const filter = { department: code };
    const count = entries.filter((entry) => matchesFilter(entry, filter)).length;
    if (!count && !(department?.active ?? false)) return [];
    const categories = lists.categories.filter((item) => item.department === code).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "vi"));
    const children: TreeNode[] = categories.flatMap((category) => {
      const categoryFilter = { department: code, category: category.id };
      const total = entries.filter((entry) => matchesFilter(entry, categoryFilter)).length;
      return total || category.active ? [{ key: `${code}/${category.id}`, label: category.name, count: total, depth: 1, filter: categoryFilter, hidden: !category.active,
        children: formatsOf(categoryFilter, 2, `${code}/${category.id}`) }] : [];
    });
    const loose = { department: code, category: NO_CATEGORY };
    const looseCount = entries.filter((entry) => matchesFilter(entry, loose)).length;
    if (looseCount) children.push({ key: `${code}/${NO_CATEGORY}`, label: "Chưa phân loại", count: looseCount, depth: 1, filter: loose, children: formatsOf(loose, 2, `${code}/${NO_CATEGORY}`) });
    return [{ key: code, label: department?.label ?? code, count, depth: 0, filter, hidden: department ? !department.active : false, children }];
  });
}

/** Keys of the folders to open so the given filter's node is visible. */
export function pathKeys(filter: TreeFilter) {
  const keys: string[] = [];
  if (filter.department) keys.push(filter.department);
  if (filter.department && filter.category) keys.push(`${filter.department}/${filter.category}`);
  return keys;
}
