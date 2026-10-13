import { hasPermission } from "@/modules/access/server/access-control";
import { TemplateLibraryView } from "@/modules/content/components/template-library-view";
import { listTemplates } from "@/modules/content/server/list-templates";

export default async function ContentTemplatesPage() {
  const [result, canManage] = await Promise.all([listTemplates(), hasPermission("content.templates")]);
  return <TemplateLibraryView templates={result.templates} loadError={result.error} canManage={canManage} />;
}
