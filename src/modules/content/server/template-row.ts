// Row shape of public.content_templates and its mapping (shared by server modules).
import type { TemplateSample } from "@/modules/content/core/template-plan";

export const TEMPLATE_COLUMNS = "id, code, department, content_format, category_id, content_type, group_name, language, reader, goal, tone, cta, tags, active, weight, body, note, created_at, updated_at";

export interface TemplateRow {
  id: string; code: string; department: string; content_format: string; category_id: string | null; content_type: string | null; group_name: string | null; language: string;
  reader: string | null; goal: string | null; tone: string | null; cta: string | null; tags: string | null;
  active: boolean; weight: number; body: string; note: string | null; created_at: string; updated_at: string;
}

export interface ContentTemplate extends TemplateSample {
  contentType: string | null;
  reader: string | null;
  goal: string | null;
  tags: string | null;
  note: string | null;
  updatedAt: string;
}

export function mapTemplateRow(row: TemplateRow): ContentTemplate {
  return {
    id: row.id,
    code: row.code,
    department: row.department,
    format: row.content_format,
    categoryId: row.category_id,
    contentType: row.content_type,
    groupName: row.group_name,
    language: row.language,
    reader: row.reader,
    goal: row.goal,
    tone: row.tone,
    cta: row.cta,
    tags: row.tags,
    active: row.active,
    weight: row.weight,
    body: row.body,
    note: row.note,
    updatedAt: row.updated_at,
  };
}
