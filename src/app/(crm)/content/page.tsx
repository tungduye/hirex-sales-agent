import { hasPermission } from "@/modules/access/server/access-control";
import { ContentLibraryView } from "@/modules/content/components/content-library-view";
import { listContent } from "@/modules/content/server/list-content";
import { listTemplates } from "@/modules/content/server/list-templates";

export default async function ContentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [result, templates, canCreate, canDelete] = await Promise.all([
    searchParams.then((params) => listContent(params)),
    listTemplates({ activeOnly: true }),
    hasPermission("content.create"),
    hasPermission("content.delete"),
  ]);
  return <ContentLibraryView items={result.items} templates={templates.templates} batches={result.batches} total={result.total} libraryTotal={result.libraryTotal} query={result.query} loadError={result.error} canCreate={canCreate} canDelete={canDelete} />;
}
