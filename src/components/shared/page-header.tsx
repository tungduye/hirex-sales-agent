import type { ReactNode } from "react";

export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold tracking-tight text-slate-950 md:text-3xl">{title}</h1><p className="mt-1 text-sm text-slate-500">{description}</p></div>
      {action}
    </div>
  );
}
