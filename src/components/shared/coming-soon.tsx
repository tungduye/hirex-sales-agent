import Link from "next/link";
import { ArrowLeft, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[calc(100vh-9rem)] items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Clock3 className="size-7" /></div>
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Coming soon</span>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">{description}</p>
        <Button asChild variant="outline" className="mt-6"><Link href="/"><ArrowLeft className="size-4" />Back to dashboard</Link></Button>
      </div>
    </div>
  );
}
