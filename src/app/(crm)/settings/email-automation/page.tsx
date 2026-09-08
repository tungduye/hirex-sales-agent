import { Activity, AlertTriangle, Clock3, MailCheck, ServerCog } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { getCampaignWorkerHealth } from "@/modules/campaigns/server/campaign-worker-health";

export default async function EmailAutomationPage() {
  const health = await getCampaignWorkerHealth();
  const latest = health.runs[0];
  const lastSuccess = health.runs.find((run) => run.status === "SUCCEEDED" || run.status === "DRY_RUN");
  const today = new Date().toDateString();
  const runsToday = health.runs.filter((run) => new Date(run.started_at).toDateString() === today);
  const duration = latest?.finished_at
    ? `${Math.max(0, new Date(latest.finished_at).getTime() - new Date(latest.started_at).getTime())} ms`
    : latest ? "In progress" : "—";
  const healthLabel = health.state.charAt(0) + health.state.slice(1).toLowerCase();

  return <>
    <PageHeader title="Email Automation" description="Worker heartbeat and safe operational history." />
    {health.state === "UNKNOWN" && <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="size-4" />Worker health is temporarily unavailable.</div>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card icon={ServerCog} label="Scheduler installation" value="Operator-managed" detail="Not inferred from heartbeat data." />
      <Card icon={Activity} label="Worker health" value={healthLabel} detail="Healthy <3m · Warning 3–10m · Stale >10m" />
      <Card icon={Clock3} label="Last run" value={latest ? new Date(latest.started_at).toLocaleString() : "No runs yet"} detail={latest?.status ?? "No heartbeat recorded"} />
      <Card icon={Clock3} label="Last successful run" value={lastSuccess?.finished_at ? new Date(lastSuccess.finished_at).toLocaleString() : "No successful run"} detail={lastSuccess?.trigger_type ?? "—"} />
      <Card icon={Clock3} label="Last duration" value={duration} detail="Start to finish" />
      <Card icon={Activity} label="Runs today" value={String(runsToday.length)} detail="Visible retained runs" />
      <Card icon={MailCheck} label="Messages sent" value={String(latest?.sent ?? 0)} detail="Latest run" />
      <Card icon={AlertTriangle} label="Failures / delivery unknown" value={`${latest?.failed ?? 0} / ${latest?.delivery_unknown ?? 0}`} detail="Latest run" />
    </div>
    <section className="mt-6 overflow-hidden rounded-xl border bg-white">
      <div className="border-b p-5"><h2 className="font-semibold">Recent runs</h2></div>
      {health.runs.length === 0 ? <p className="p-8 text-sm text-slate-500">No worker heartbeat recorded yet.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500"><tr>{["Started", "Status", "Trigger", "Campaigns", "Deliveries", "Sent", "Failed", "Unknown"].map((label) => <th className="px-4 py-3" key={label}>{label}</th>)}</tr></thead><tbody>{health.runs.map((run) => <tr className="border-t" key={run.id}><td className="px-4 py-3">{new Date(run.started_at).toLocaleString()}</td><td className="px-4 py-3 font-medium">{run.status}</td><td className="px-4 py-3">{run.trigger_type}</td><td className="px-4 py-3">{run.campaigns_considered}</td><td className="px-4 py-3">{run.deliveries_processed}</td><td className="px-4 py-3">{run.sent}</td><td className="px-4 py-3">{run.failed}</td><td className="px-4 py-3">{run.delivery_unknown}</td></tr>)}</tbody></table></div>}
    </section>
  </>;
}

function Card({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <div className="rounded-xl border bg-white p-5 shadow-sm"><Icon className="mb-4 size-5 text-blue-600" /><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></div>;
}
