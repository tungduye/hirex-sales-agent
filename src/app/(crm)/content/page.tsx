import { hasPermission } from "@/modules/access/server/access-control";
import { ContentLibraryView } from "@/modules/content/components/content-library-view";
import { listContent } from "@/modules/content/server/list-content";

export default async function ContentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [result, canCreate, canDelete] = await Promise.all([
    searchParams.then((params) => listContent(params)),
    hasPermission("content.create"),
    hasPermission("content.delete"),
  ]);
  return <ContentLibraryView items={result.items} batches={result.batches} total={result.total} libraryTotal={result.libraryTotal} query={result.query} loadError={result.error} canCreate={canCreate} canDelete={canDelete} />;
}
