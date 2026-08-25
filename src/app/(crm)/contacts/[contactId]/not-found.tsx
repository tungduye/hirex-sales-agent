import Link from "next/link";
import { ArrowLeft, ContactRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ContactNotFound() {
  return (
    <div className="rounded-xl border border-dashed bg-white px-6 py-16 text-center shadow-sm">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><ContactRound className="size-7" /></div>
      <h1 className="mt-5 text-xl font-bold">Contact not found</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">This contact does not exist or is not available in your workspace.</p>
      <Button asChild variant="outline" className="mt-6"><Link href="/contacts"><ArrowLeft className="size-4" /> Back to Contacts</Link></Button>
    </div>
  );
}
