import { hasPermission } from "@/modules/access/server/access-control";
import { TemplateLibraryView } from "@/modules/content/components/template-library-view";
import { listCategories } from "@/modules/content/server/list-categories";
import { listTemplates } from "@/modules/content/server/list-templates";

export default async function ContentTemplatesPage() {
  const [result, categories, canManage] = await Promise.all([listTemplates(), listCategories(), hasPermission("content.templates")]);
  return <TemplateLibraryView templates={result.templates} categories={categories} loadError={result.error} canManage={canManage} />;
}
