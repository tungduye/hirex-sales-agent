import { hasPermission } from "@/modules/access/server/access-control";
import { ContentSettingsView } from "@/modules/content/components/content-settings-view";
import { loadContentSettings } from "@/modules/content/server/content-settings-data";
import { listCategories } from "@/modules/content/server/list-categories";

export default async function ContentSettingsPage() {
  const [settings, categories, canManage] = await Promise.all([loadContentSettings(), listCategories(), hasPermission("content.templates")]);
  return <ContentSettingsView settings={settings} categories={categories} canManage={canManage} />;
}
