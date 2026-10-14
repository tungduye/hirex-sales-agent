import type { ReactNode } from "react";
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
  /** "Bản tin hôm nay" of Trợ lý HireX, shown under the header. */
  brief?: ReactNode;
}

const metrics: Array<{
  key: keyof DashboardMetrics;
  label: string;
  icon: typeof ContactRound;
}> = [
  { key: "totalContacts", label: "Tổng liên hệ", icon: ContactRound },
  { key: "companies", label: "Công ty", icon: Building2 },
  { key: "newLeads", label: "Khách hàng tiềm năng mới", icon: UserPlus },
  { key: "qualifiedLeads", label: "Khách hàng đủ điều kiện", icon: Target },
];

export function DashboardView({ fullName, data, brief }: DashboardViewProps) {
  return (
    <>
      <PageHeader
        title={`Xin chào, ${fullName ?? "bạn"}`}
        description="Tổng quan hoạt động trong không gian bán hàng của bạn."
        action={
          <Button asChild>
            <Link href="/contacts">
              <Plus className="size-4" />
              Thêm liên hệ
            </Link>
          </Button>
        }
      />

      {brief}

      {data.metricsHaveError && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Không thể tải một số số liệu tổng quan. Vui lòng thử lại.
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ key, label, icon: Icon }) => (
          <div key={key} className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Icon className="size-5" />
              </div>
              <span className="text-xs font-medium text-slate-400">Dữ liệu trực tiếp</span>
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
              <h2 className="font-semibold">Liên hệ gần đây</h2>
              <p className="mt-0.5 text-xs text-slate-500">Các liên hệ mới nhất trong không gian này</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/contacts">
                Xem tất cả <ArrowUpRight className="size-4" />
              </Link>
            </Button>
          </div>

          {data.recentContactsError ? (
            <EmptyPanel message="Không thể tải liên hệ gần đây. Vui lòng thử lại." />
          ) : data.recentContacts.length === 0 ? (
            <EmptyPanel message="Chưa có liên hệ" />
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
                      {[contact.jobTitle, contact.companyName].filter(Boolean).join(" · ") || "Chưa có chức danh hoặc công ty"}
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
            <h2 className="font-semibold">Hoạt động gần đây</h2>
            <p className="mt-0.5 text-xs text-slate-500">Các cập nhật mới nhất trong không gian của bạn</p>
          </div>
          <EmptyPanel message="Chưa có hoạt động gần đây" detail="Tính năng theo dõi hoạt động sắp được bổ sung." />
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
  return new Intl.DateTimeFormat("vi-VN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(createdAt));
}
