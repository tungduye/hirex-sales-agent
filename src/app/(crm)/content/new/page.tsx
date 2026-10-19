import { PermissionPage } from "@/modules/access/server/permission-page";
import { ContentSettingsProvider } from "@/modules/content/components/content-settings-context";
import { CreateContentScreen, type JobChoice } from "@/modules/content/components/create-content-screen";
import { loadContentSettings } from "@/modules/content/server/content-settings-data";
import { listCategories } from "@/modules/content/server/list-categories";
import { listTemplates } from "@/modules/content/server/list-templates";
import { listJobs } from "@/modules/jobs/server/jobs-data";

export default async function NewContentPage({ searchParams }: { searchParams: Promise<{ template?: string; job?: string }> }) {
  const { template, job } = await searchParams;
  const [settings, categories, templates, jobs] = await Promise.all([loadContentSettings(), listCategories(), listTemplates({ activeOnly: true }), listJobs()]);
  // Bảng Job (open jobs) is offered only to people who may see it.
  const choices: JobChoice[] = jobs.jobs.filter((job) => job.status === "OPEN").map((job) => ({ id: job.id, title: job.title, location: job.location, careerTrack: job.careerTrack,
    companyName: job.companyName, companyNamePublic: job.companyNamePublic, salaryRange: job.salaryRange, japaneseLevelMin: job.japaneseLevelMin,
    sellingPoints: job.sellingPoints, summary: job.summary, requirements: job.requirements }));
  return <PermissionPage permission="content.create"><ContentSettingsProvider settings={settings}><CreateContentScreen templates={templates.templates} categories={categories} jobs={choices} initialTemplateId={typeof template === "string" ? template : null} initialJobId={typeof job === "string" ? job : null} /></ContentSettingsProvider></PermissionPage>;
}
