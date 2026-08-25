import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CompanyStatus, LeadStatus } from "@/types/crm";

const styles: Record<LeadStatus | CompanyStatus, string> = {
  NEW: "bg-sky-50 text-sky-700",
  CONTACTED: "bg-indigo-50 text-indigo-700",
  ENGAGED: "bg-violet-50 text-violet-700",
  QUALIFIED: "bg-emerald-50 text-emerald-700",
  OPPORTUNITY: "bg-amber-50 text-amber-700",
  WON: "bg-green-50 text-green-700",
  LOST: "bg-slate-100 text-slate-600",
  DO_NOT_CONTACT: "bg-rose-50 text-rose-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PROSPECT: "bg-blue-50 text-blue-700",
  INACTIVE: "bg-slate-100 text-slate-600",
};

export function StatusBadge({ status }: { status: LeadStatus | CompanyStatus }) {
  return <Badge className={cn(styles[status])}>{status.replaceAll("_", " ")}</Badge>;
}
