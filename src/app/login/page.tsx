import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { LoginForm } from "@/modules/identity/components/login-form";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="grid min-h-screen bg-slate-50 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="hidden flex-col justify-between bg-slate-950 p-12 text-white lg:flex xl:p-16">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600"><Sparkles className="size-5" /></div>
          <div><p className="font-bold">HireX Sales Agent</p><p className="text-xs text-slate-400">CRM workspace</p></div>
        </div>
        <div className="max-w-xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-blue-400">Sales workspace</p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight xl:text-5xl">Build stronger customer relationships from one focused workspace.</h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-400">Your companies, contacts, and sales activity stay organized in a secure CRM foundation.</p>
        </div>
        <p className="text-xs text-slate-500">Phase 1B.2 · Authentication foundation</p>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-8 lg:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-600 text-white"><Sparkles className="size-5" /></div>
            <div><p className="font-bold">HireX Sales Agent</p><p className="text-xs text-slate-500">CRM workspace</p></div>
          </div>
          <div className="rounded-2xl border bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Sign in with your HireX account to continue.</p>
            <LoginForm />
          </div>
          <p className="mt-5 text-center text-xs text-slate-400">Protected by Supabase Authentication</p>
        </div>
      </section>
    </main>
  );
}
