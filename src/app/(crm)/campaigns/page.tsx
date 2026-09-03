import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { listCampaigns } from "@/modules/campaigns/server/campaign-data";

export default async function CampaignsPage() {
  const { campaigns, error } = await listCampaigns();
  return <><PageHeader title="Campaigns" description="Create, schedule and monitor bounded email campaigns." action={<Button asChild><Link href="/campaigns/new"><Plus className="size-4"/>New Campaign</Link></Button>}/>
    {error ? <div className="rounded-xl border bg-white p-8 text-sm text-rose-600">{error}</div> : campaigns.length===0 ? <div className="rounded-xl border border-dashed bg-white p-16 text-center"><h2 className="text-xl font-semibold">No campaigns yet</h2><p className="mt-2 text-sm text-slate-500">Create a draft, add an explicit audience, then review it before sending.</p></div> : <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr>{["Campaign","Status","Recipients","Sent","Pending","Failed","Suppressed","Unknown","Senders"].map(x=><th className="px-4 py-3" key={x}>{x}</th>)}</tr></thead><tbody className="divide-y">{campaigns.map(c=><tr key={c.id}><td className="px-4 py-4 font-semibold"><Link className="text-blue-700 hover:underline" href={`/campaigns/${c.id}`}>{c.name}</Link></td><td className="px-4">{c.status}</td><td className="px-4">{c.recipients}</td><td className="px-4">{c.sent}</td><td className="px-4">{c.pending}</td><td className="px-4">{c.failed}</td><td className="px-4">{c.suppressed}</td><td className="px-4">{c.deliveryUnknown}</td><td className="px-4">{c.senders}</td></tr>)}</tbody></table></div>}</>;
}
