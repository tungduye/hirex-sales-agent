import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  ContactRound,
  Plus,
  Target,
  UserPlus,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/modules/crm/components/status-badge";
import type {
  DashboardData,
  DashboardMetrics,
} from "@/modules/crm/dashboard/types/dashboard";

interface DashboardViewProps {
  fullName: string | null;
  data: DashboardData;
}

const metrics: Array<{
  key: keyof DashboardMetrics;
  label: string;
  icon: typeof ContactRound;
}> = [
  { key: "totalContacts", label: "Total Contacts", icon: ContactRound },
  { key: "companies", label: "Companies", icon: Building2 },
  { key: "newLeads", label: "New Leads", icon: UserPlus },
  { key: "qualifiedLeads", label: "Qualified Leads", icon: Target },
];

export function DashboardView({ fullName, data }: DashboardViewProps) {
  return (
    <>
      <PageHeader
        title={`Good morning, ${fullName ?? "there"}`}
        description="Here’s what’s happening across your sales workspace."
        action={
          <Button asChild>
            <Link href="/contacts">
              <Plus className="size-4" />
              Add contact
            </Link>
          </Button>
        }
      />

      {data.metricsHaveError && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some dashboard totals could not be loaded. Please try again.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ key, label, icon: Icon }) => (
          <div key={key} className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Icon className="size-5" />
              </div>
              <span className="text-xs font-medium text-slate-400">Live data</span>
            </div>
            <p className="mt-5 text-3xl font-bold tracking-tight">
              {data.metrics[key] ?? "—"}
            </p>
            <p className="mt-1 text-sm text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-semibold">Recent Contacts</h2>
              <p className="mt-0.5 text-xs text-slate-500">Newest contacts in this workspace</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/contacts">
                View all <ArrowUpRight className="size-4" />
              </Link>
            </Button>
          </div>

          {data.recentContactsError ? (
            <EmptyPanel message="Recent contacts could not be loaded. Please try again." />
          ) : data.recentContacts.length === 0 ? (
            <EmptyPanel message="No contacts yet" />
          ) : (
            <div className="divide-y">
              {data.recentContacts.map((contact) => (
                <div key={contact.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                    {contact.initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{contact.fullName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[contact.jobTitle, contact.companyName].filter(Boolean).join(" · ") || "No role or company"}
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <StatusBadge status={contact.leadStatus} />
                  </div>
                  <time
                    dateTime={contact.createdAt}
                    className="w-24 text-right text-xs text-slate-400"
                  >
                    {formatCreatedDate(contact.createdAt)}
                  </time>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Recent Activity</h2>
            <p className="mt-0.5 text-xs text-slate-500">Latest updates in your workspace</p>
          </div>
          <EmptyPanel message="No recent activity yet" detail="Activity tracking is coming soon." />
        </div>
      </section>
    </>
  );
}

function EmptyPanel({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-5 py-8 text-center">
      <p className="text-sm font-semibold text-slate-700">{message}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

function formatCreatedDate(createdAt: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(createdAt));
}
