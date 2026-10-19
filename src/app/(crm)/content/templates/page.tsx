import { hasPermission } from "@/modules/access/server/access-control";
import { TemplateLibraryView } from "@/modules/content/components/template-library-view";
import { listCategories } from "@/modules/content/server/list-categories";
import { listTemplates } from "@/modules/content/server/list-templates";
import { ContentSettingsProvider } from "@/modules/content/components/content-settings-context";
import { loadContentSettings } from "@/modules/content/server/content-settings-data";

export default async function ContentTemplatesPage() {
  const [result, categories, canManage, settings] = await Promise.all([listTemplates(), listCategories(), hasPermission("content.templates"), loadContentSettings()]);
  return <ContentSettingsProvider settings={settings}><TemplateLibraryView templates={result.templates} categories={categories} loadError={result.error} canManage={canManage} /></ContentSettingsProvider>;
}
