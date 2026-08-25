import { ArrowUpRight, Building2, CheckCircle2, ContactRound, Plus, Target, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { contacts, dashboardMetrics, recentActivities } from "@/modules/crm/data/mock-crm";
import { StatusBadge } from "@/modules/crm/components/status-badge";

const metricIcons = [ContactRound, Building2, UserPlus, Target];

export function DashboardView() {
  return (
    <>
      <PageHeader title="Good morning, Alex" description="Here’s what’s happening across your sales workspace." action={<Button><Plus className="size-4" />Add contact</Button>} />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((metric, index) => {
          const Icon = metricIcons[index];
          return <div key={metric.label} className="rounded-xl border bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Icon className="size-5" /></div><span className="flex items-center text-xs font-semibold text-emerald-600">{metric.direction === "up" && <ArrowUpRight className="size-3.5" />}{metric.change}</span></div><p className="mt-5 text-3xl font-bold tracking-tight">{metric.value}</p><p className="mt-1 text-sm text-slate-500">{metric.label}</p></div>;
        })}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">Recent Contacts</h2><p className="mt-0.5 text-xs text-slate-500">Contacts with the latest activity</p></div><Button variant="ghost" size="sm">View all <ArrowUpRight className="size-4" /></Button></div>
          <div className="divide-y">{contacts.slice(0, 5).map((contact) => <div key={contact.id} className="flex items-center gap-3 px-5 py-3.5"><div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{contact.initials}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{contact.fullName}</p><p className="truncate text-xs text-slate-500">{contact.jobTitle} · {contact.company}</p></div><div className="hidden sm:block"><StatusBadge status={contact.leadStatus} /></div><span className="w-20 text-right text-xs text-slate-400">{contact.lastActivity}</span></div>)}</div>
        </div>
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4"><h2 className="font-semibold">Recent Activity</h2><p className="mt-0.5 text-xs text-slate-500">Latest updates in your workspace</p></div>
          <div className="p-5">{recentActivities.map((activity, index) => <div key={activity.id} className="flex gap-3"><div className="flex flex-col items-center"><div className="flex size-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="size-4" /></div>{index < recentActivities.length - 1 && <div className="my-1 h-full w-px bg-slate-200" />}</div><div className="pb-5"><p className="text-sm font-semibold">{activity.title}</p><p className="mt-0.5 text-xs leading-5 text-slate-500">{activity.detail}</p><p className="mt-1 text-[11px] text-slate-400">{activity.timestamp}</p></div></div>)}</div>
        </div>
      </section>
    </>
  );
}
