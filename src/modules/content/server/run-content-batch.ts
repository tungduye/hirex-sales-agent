import "server-only";

import { createPrivilegedClient } from "@/lib/supabase/privileged";
import type { ContentBrief } from "@/modules/content/core/content-options";
import { contentShingles, storedSimilarity, type IndexedContent } from "@/modules/content/core/content-similarity";
import { briefFactText, briefTitlePrefix, languageParts, type ContentBriefWithCategory } from "@/modules/content/core/content-prompt";
import { produceUniqueContent, recheckAgainst, type Draft } from "@/modules/content/core/produce-unique-content";
import { applyTitlePrefix, assignTemplates, findBlockedTerm, leakedNumbers, lengthRange, parseBlockedTerms, pickTemplates, templateProfile, type TemplateSample } from "@/modules/content/core/template-plan";
import { generateContentRound, generateFromTemplate } from "@/modules/content/server/generate-content";
import { mapTemplateRow, TEMPLATE_COLUMNS, type TemplateRow } from "@/modules/content/server/template-row";

const PAGE_SIZE = 1000;
const LIBRARY_LIMIT = 200_000;
const RECENT_SAME_JOB = 6;
const KNOWN_ERRORS = new Set(["AI_NOT_CONFIGURED", "AI_UNAVAILABLE", "AI_INVALID_OUTPUT", "LIBRARY_UNAVAILABLE", "LIBRARY_TOO_LARGE", "SAVE_FAILED"]);

type Db = ReturnType<typeof createPrivilegedClient>;
interface LibraryRow { id: string; body: string; job_title: string }

/**
 * Reads every content item of the workspace (Supabase returns at most 1,000 rows per request).
 * The duplicate rule covers the whole library, so this fails rather than checking part of it.
 */
async function loadLibrary(db: Db, workspaceId: string, since?: string): Promise<LibraryRow[]> {
  const rows: LibraryRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db.from("content_items").select("id, body, job_title").eq("workspace_id", workspaceId);
    if (since) query = query.gte("created_at", since);
    const { data, error } = await query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("LIBRARY_UNAVAILABLE");
    const page = (data ?? []) as LibraryRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    if (rows.length >= LIBRARY_LIMIT) throw new Error("LIBRARY_TOO_LARGE");
  }
}

/** Templates picked in the popup, or the department's active templates to choose from. */
async function loadTemplates(db: Db, workspaceId: string, brief: ContentBrief): Promise<{ chosen: TemplateSample[]; candidates: TemplateSample[] }> {
  if (brief.templateIds.length > 0) {
    const { data } = await db.from("content_templates").select(TEMPLATE_COLUMNS).eq("workspace_id", workspaceId).in("id", brief.templateIds);
    const byId = new Map(((data ?? []) as TemplateRow[]).map((row) => [row.id, mapTemplateRow(row)]));
    return { chosen: brief.templateIds.flatMap((id) => byId.get(id) ?? []), candidates: [] };
  }
  const { data } = await db.from("content_templates").select(TEMPLATE_COLUMNS).eq("workspace_id", workspaceId).eq("department", brief.department).eq("active", true).limit(500);
  return { chosen: [], candidates: ((data ?? []) as TemplateRow[]).map(mapTemplateRow) };
}

/** The "Content mẫu tự dán" text is used like a chosen template, ahead of the others. */
const PASTED_ID = "pasted";
function pastedTemplate(brief: ContentBrief): TemplateSample | null {
  if (!brief.sampleContent) return null;
  return { id: PASTED_ID, code: "MẪU DÁN", department: brief.department, language: brief.contentLanguage, groupName: null, tone: null, cta: null, body: brief.sampleContent, weight: 10, active: true, format: brief.contentFormat, categoryId: brief.categoryId };
}

/** Runs `task` for every item with at most `limit` running at once; failed items become null. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  const errors: unknown[] = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const current = next++;
      try { results[current] = await task(items[current], current); } catch (error) { errors.push(error); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (errors.length === items.length && errors.length > 0) throw errors[0];
  return results;
}

const index = (rows: LibraryRow[]): IndexedContent[] => rows.map((row) => ({ id: row.id, shingles: contentShingles(row.body) }));

// Batches of one workspace run one after another in this process, so two batches started at
// the same time cannot both save near-identical content. (The web app runs as a single process.)
const workspaceQueues = new Map<string, Promise<unknown>>();
function serialized<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
  const previous = workspaceQueues.get(workspaceId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  workspaceQueues.set(workspaceId, next);
  void next.finally(() => { if (workspaceQueues.get(workspaceId) === next) workspaceQueues.delete(workspaceId); }).catch(() => undefined);
  return next;
}

export interface ContentBatchJob {
  batchId: string;
  workspaceId: string;
  userId: string;
  brief: ContentBriefWithCategory;
  model: string;
}

/** Generates, de-duplicates and saves one batch, then records its outcome. Never throws. */
export function runContentBatch(job: ContentBatchJob): Promise<void> {
  return serialized(job.workspaceId, () => runNow(job));
}

async function runNow({ batchId, workspaceId, userId, brief, model }: ContentBatchJob) {
  const db = createPrivilegedClient();
  const finish = async (values: { status: string; saved_count: number; rejected_count: number; error_code: string | null }) => {
    await db.from("content_batches").update({ ...values, completed_at: new Date().toISOString() }).eq("id", batchId).eq("workspace_id", workspaceId);
  };

  try {
    const startedAt = new Date(Date.now() - 5_000).toISOString();
    const [libraryRows, templateSource] = await Promise.all([loadLibrary(db, workspaceId), loadTemplates(db, workspaceId, brief)]);
    const knownIds = new Set(libraryRows.map((row) => row.id));
    const jobKey = brief.jobTitle.toLocaleLowerCase("vi");
    const recentSameJob = libraryRows.filter((row) => row.job_title.toLocaleLowerCase("vi") === jobKey).slice(-RECENT_SAME_JOB).map((row) => row.body);

    const pasted = pastedTemplate(brief);
    const chosen = pasted ? [pasted, ...templateSource.chosen] : templateSource.chosen;
    const templates = pickTemplates({ chosen, candidates: templateSource.candidates, department: brief.department, language: brief.contentLanguage, quantity: brief.quantity, seed: brief.jobTitle, format: brief.contentFormat, categoryId: brief.categoryId });
    const templateById = new Map(templates.map((template) => [template.id, template]));
    const prefix = briefTitlePrefix(brief);
    const blocked = parseBlockedTerms(brief.blockedTerms);
    const facts = briefFactText(brief);
    const languageCount = languageParts(brief.contentLanguage).length;

    // With samples, each content is written from one sample in its own call (closer to the sample
    // than a single call writing everything); without samples, one call writes the whole round.
    const generate = async ({ count, round, avoid }: { count: number; round: number; avoid: string[] }): Promise<Draft[]> => {
      if (templates.length === 0) return generateContentRound({ brief, count, round, avoid, model });
      const plan = assignTemplates(templates, count, round).filter((template): template is TemplateSample => Boolean(template));
      const drafts = await mapLimit<TemplateSample, Draft | null>(plan, 3, async (template) => {
        const draft = await generateFromTemplate({ brief, template, round, avoid, model });
        return draft ? { ...draft, templateId: template.id } : null;
      });
      return drafts.flatMap((draft) => draft ? [draft] : []);
    };

    const prepare = (draft: Draft): Draft | null => {
      const item: Draft = { ...draft, title: applyTitlePrefix(draft.title, prefix) };
      if (findBlockedTerm(`${item.title}\n${item.body}`, blocked)) return null;
      const template = draft.templateId ? templateById.get(draft.templateId) : undefined;
      if (template) {
        // Facts copied from the sample (its salary, years, headcount…) are never saved.
        if (leakedNumbers(`${item.title}\n${item.body}`, template.body, facts).length > 0) return null;
        if (brief.contentFormat === "POST_LONG" && (template.format ?? "POST_LONG") === "POST_LONG") {
          const [min, max] = lengthRange(templateProfile(template.body), languageCount);
          if (item.body.length < min || item.body.length > max) return null;
        }
      }
      return { ...item, templateId: template && template.id !== PASTED_ID ? template.id : null };
    };

    const result = await produceUniqueContent({
      quantity: brief.quantity,
      library: index(libraryRows),
      // A new content must not be a near-copy of the sample it followed either.
      references: templates.map((template) => ({ id: `template:${template.code}`, shingles: contentShingles(template.body) })),
      initialAvoid: recentSameJob,
      generate,
      prepare,
    });

    // Items saved elsewhere (another server process) while this batch was generated.
    const newer = (await loadLibrary(db, workspaceId, startedAt)).filter((row) => !knownIds.has(row.id));
    const toSave = recheckAgainst(result.accepted, index(newer));

    let saved = 0;
    if (toSave.length > 0) {
      const { data, error } = await db.from("content_items").insert(toSave.map((item) => ({
        workspace_id: workspaceId,
        batch_id: batchId,
        title: item.title.slice(0, 300),
        body: item.body,
        job_title: brief.jobTitle,
        content_language: brief.contentLanguage,
        content_format: brief.contentFormat,
        department: brief.department,
        category_id: brief.categoryId,
        style: brief.style,
        max_similarity: storedSimilarity(item.similarity),
        most_similar_item_id: item.similarItemId,
        template_id: item.templateId ?? null,
        created_by: userId,
      }))).select("id");
      if (error || !data) throw new Error("SAVE_FAILED");
      saved = data.length;
    }

    const rejected = brief.quantity - saved;
    await finish({
      status: rejected === 0 ? "COMPLETED" : saved > 0 ? "PARTIAL" : "FAILED",
      saved_count: saved,
      rejected_count: rejected,
      error_code: saved === 0 ? (result.dropped > 0 ? "DRAFTS_REJECTED" : "ALL_TOO_SIMILAR") : null,
    });
  } catch (error) {
    const code = error instanceof Error && KNOWN_ERRORS.has(error.message) ? error.message : "AI_UNAVAILABLE";
    console.error("[content] batch failed", batchId, error instanceof Error ? error.message : error);
    await finish({ status: "FAILED", saved_count: 0, rejected_count: 0, error_code: code }).catch(() => undefined);
  }
}
