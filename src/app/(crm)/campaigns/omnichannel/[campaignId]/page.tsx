import { notFound } from "next/navigation";
import { getChannelCampaign } from "@/modules/channels/server/get-channel-campaign-data";
import { startChannelCampaign } from "@/modules/channels/server/channel-campaign-actions";

export default async function OmnichannelCampaignDetail({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const data = await getChannelCampaign(campaignId);
  if (!data) notFound();
  const deliveryLabels = ["Sent", "Failed", "Delivery unknown"] as const;

  return <div className="space-y-6">
    <header>
      <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Omnichannel campaign</p>
      <h1 className="text-3xl font-bold">{data.campaign.name}</h1>
      <p className="text-sm text-slate-500">{data.campaign.status}</p>
      {data.campaign.status === "DRAFT" && <form action={startChannelCampaign.bind(null, campaignId)}>
        <button type="submit" className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Start campaign</button>
      </form>}
    </header>
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Delivery status">
      {deliveryLabels.map((label, index) => <div key={label} className="rounded-xl border bg-white p-4">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{data.deliveryCounts[index] ?? "—"}</p>
      </div>)}
    </section>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="font-semibold">Sequence steps</h2>
      {data.steps.map(step => <div key={step.id} className="mt-3 rounded-lg border p-3 text-sm">Step {step.position} · delay {step.delay_minutes} min · {step.allowed_channels.join(", ")}</div>)}
    </section>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="font-semibold">Recipients</h2>
      <p className="mt-2 text-sm text-slate-500">{data.recipients.length} recipients</p>
      {data.recipients.map(recipient => <p key={recipient.id} className="mt-2 text-sm">{recipient.contacts?.[0]?.full_name ?? "Contact"} · {recipient.status}</p>)}
    </section>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="font-semibold">Timeline</h2>
      {data.events.map(event => <p key={event.id} className="mt-2 text-sm">{event.event_type} · {new Date(event.created_at).toLocaleString()}</p>)}
    </section>
  </div>;
}
