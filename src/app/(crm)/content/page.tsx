import { hasPermission } from "@/modules/access/server/access-control";
import { ContentLibraryView } from "@/modules/content/components/content-library-view";
import { listCategories } from "@/modules/content/server/list-categories";
import { listContent } from "@/modules/content/server/list-content";
import { listTemplates } from "@/modules/content/server/list-templates";
import { ContentSettingsProvider } from "@/modules/content/components/content-settings-context";
import { loadContentSettings } from "@/modules/content/server/content-settings-data";

export default async function ContentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [result, templates, categories, canCreate, canDelete, settings] = await Promise.all([
    searchParams.then((params) => listContent(params)),
    listTemplates({ activeOnly: true }),
    listCategories(),
    hasPermission("content.create"),
    hasPermission("content.delete"),
    loadContentSettings(),
  ]);
  return <ContentSettingsProvider settings={settings}><ContentLibraryView items={result.items} templates={templates.templates} categories={categories} batches={result.batches} total={result.total} libraryTotal={result.libraryTotal} query={result.query} loadError={result.error} canCreate={canCreate} canDelete={canDelete} /></ContentSettingsProvider>;
}
