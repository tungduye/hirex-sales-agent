import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { createCampaign } from "@/modules/campaigns/server/campaign-actions";

export default function NewCampaignPage() {
  return <><PageHeader title="New Campaign" description="Create a plain-text draft. Audience and senders are added after creation."/><form action={createCampaign} className="max-w-3xl space-y-5 rounded-xl border bg-white p-6"><label className="block text-sm font-medium">Campaign name<input name="name" required maxLength={200} className="mt-2 h-10 w-full rounded-lg border px-3"/></label><label className="block text-sm font-medium">Subject template<input name="subject" required maxLength={998} placeholder="Hello {{first_name}}" className="mt-2 h-10 w-full rounded-lg border px-3"/></label><label className="block text-sm font-medium">Plain-text body<textarea name="body" required maxLength={100000} rows={12} className="mt-2 w-full rounded-lg border p-3"/></label><p className="text-xs text-slate-500">Missing variables render blank. HTML and attachments are intentionally unavailable.</p><Button type="submit">Create draft</Button></form></>;
}
