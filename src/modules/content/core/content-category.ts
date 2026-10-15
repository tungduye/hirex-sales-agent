// "Phân loại": a per-department list of content kinds (Sale → Giới thiệu, Dạng share…).
export interface ContentCategory {
  id: string;
  department: string;
  name: string;
  active: boolean;
  sort: number;
}

/** Active categories of a department, in display order. */
export function categoriesOf(categories: ContentCategory[], department: string, { includeInactive = false } = {}) {
  return categories
    .filter((category) => category.department === department && (includeInactive || category.active))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "vi"));
}
